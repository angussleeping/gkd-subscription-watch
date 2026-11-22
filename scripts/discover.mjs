// GitHub 全站 GKD 订阅源动态发现、验证与自动降级
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CORE_SOURCES, DISCOVERY, PATHS } from './config.mjs';
import { fetchWithFallback, parseSubscription, stats } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = rel => path.join(ROOT, rel);

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(p(file), 'utf8')); }
  catch { return fallback; }
}

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

const TOKEN = getToken();

async function api(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'gkd-subscription-watch/1.0',
      Accept: 'application/vnd.github+json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${url}`);
  return resp.json();
}

// 并发控制器
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { error: e.message }; }
    }
  }));
  return results;
}

function sourceKey(fullName) {
  return 'gh_' + fullName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function isSubscriptionRepo(repo) {
  const text = `${repo.full_name} ${repo.description || ''}`;
  if (!/gkd/i.test(text)) return false;
  if (!/subscri|订阅|规则|rules?|rule/i.test(text)) return false;
  const excl = new RegExp(DISCOVERY.excludePattern, 'i');
  if (excl.test(text)) return false;
  return true;
}

function daysSince(iso) {
  if (!iso) return 9999;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function makeScore(repo, groups, origin) {
  const stars = repo.stargazers_count || 0;
  const starScore = Math.min(30, Math.log10(Math.max(10, stars)) * 10);
  const d = daysSince(repo.pushed_at);
  const freshScore = d <= 30 ? 30 : d <= 90 ? 20 : d <= 180 ? 10 : 0;
  const groupScore = Math.min(30, Math.sqrt(groups) * 2);
  const bonus = origin === 'community' ? 8 : 0;
  return Math.round(starScore + freshScore + groupScore + bonus);
}

async function searchRepositories() {
  const found = new Map();
  for (const q of DISCOVERY.queries) {
    for (let page = 1; page <= DISCOVERY.searchPages; page++) {
      try {
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`;
        const data = await api(url);
        for (const r of data.items || []) found.set(r.full_name, r);
        if ((data.items || []).length < 100) break;
      } catch (e) {
        console.error(`  [搜索失败] ${q} page ${page}: ${e.message}`);
        break;
      }
    }
  }
  return found;
}

// 从社区收录名单提取 GitHub 仓库种子（含仓库名不含 gkd 的订阅）
async function communitySeeds() {
  const seeds = new Map();
  try {
    const { text } = await fetchWithFallback([DISCOVERY.communityList], 20000);
    const patterns = [
      /(?:raw\.githubusercontent\.com|raw\.gitmirror\.com)\/([^/\s`"')]+)\/([^/\s`"')]+)\/([^/\s`"')]+)\/([^\s`"')]+\.json5)/gi,
      /cdn\.jsdelivr\.net\/gh\/([^/\s@`"')]+)\/([^/\s@`"')]+)@([^/\s`"')]+)\/([^\s`"')]+\.json5)/gi,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text))) {
        const [, owner, repo, branch, filePath] = m;
        const fullName = `${owner}/${repo}`;
        if (!seeds.has(fullName)) seeds.set(fullName, { fullName, branch, path: filePath });
      }
    }
    console.log(`  社区名单种子: ${seeds.size} 个`);
  } catch (e) {
    console.error(`  [社区名单读取失败] ${e.message}`);
  }
  return seeds;
}

// 探测仓库中可用的订阅文件路径
async function probePath(fullName, preferredBranch) {
  let branch = preferredBranch;
  if (!branch) {
    const info = await api(`https://api.github.com/repos/${fullName}`);
    if (info.archived) return { archived: true };
    branch = info.default_branch || 'main';
  }
  const tree = await api(`https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const paths = (tree.tree || [])
    .filter(t => t.type === 'blob' && /\.json5?$/i.test(t.path) && !/node_modules/.test(t.path))
    .map(t => t.path);
  for (const re of DISCOVERY.pathPriority) {
    const hit = paths.find(x => re.test(x) && !DISCOVERY.pathExclude.test(x));
    if (hit) return { branch, path: hit };
  }
  return { branch, path: null };
}

function urlsFor(fullName, branch, filePath) {
  return [
    `https://raw.githubusercontent.com/${fullName}/${branch}/${filePath}`,
    `https://cdn.jsdelivr.net/gh/${fullName}@${branch}/${filePath}`,
    `https://jsd.admincdn.com/gh/${fullName}@${branch}/${filePath}`,
  ];
}

// 抓取并验证订阅文件，返回统计信息
async function validateSource(source) {
  const { text } = await fetchWithFallback(source.urls, 18000);
  const sub = parseSubscription(text);
  if (!Number.isFinite(sub.id)) throw new Error('订阅 ID 无效');
  if (!sub.apps.size) throw new Error('无 apps');
  if (sub.groupCount < DISCOVERY.minGroups) throw new Error(`规则组过少 (${sub.groupCount})`);
  return { ...stats(sub), id: sub.id, bytes: text.length };
}

/**
 * 主入口：返回本周可用的动态源清单
 * @param {object} prev 上一次的 data/sources.json
 */
export async function discoverSources(prev) {
  console.log('[发现] 搜索 GitHub 全站 GKD 订阅仓库...');
  const searched = await searchRepositories();
  const seeds = await communitySeeds();
  console.log(`  搜索到 ${searched.size} 个仓库，社区种子 ${seeds.size} 个`);

  // 汇总候选：搜索结果 + 社区种子 + 历史注册源 + 核心源
  const candidates = new Map();
  for (const r of searched.values()) {
    if (isSubscriptionRepo(r)) candidates.set(r.full_name, { repo: r, origin: 'search' });
  }
  for (const [fullName, s] of seeds) {
    if (candidates.has(fullName)) { candidates.get(fullName).origin = 'community'; continue; }
    try {
      const repo = await api(`https://api.github.com/repos/${fullName}`);
      if (isSubscriptionRepo(repo)) candidates.set(fullName, { repo, origin: 'community', ...s });
    } catch (e) { console.error(`  [种子检查失败] ${fullName}: ${e.message}`); }
  }
  for (const s of (prev?.active || [])) {
    if (!candidates.has(s.fullName)) {
      try {
        const repo = await api(`https://api.github.com/repos/${s.fullName}`);
        candidates.set(s.fullName, { repo, origin: s.origin || 'search', branch: s.branch, path: s.path });
      } catch (e) { console.error(`  [历史源检查失败] ${s.fullName}: ${e.message}`); }
    } else if (s.branch && s.path) {
      Object.assign(candidates.get(s.fullName), { branch: s.branch, path: s.path });
    }
  }
  for (const s of CORE_SOURCES) {
    if (!candidates.has(s.fullName)) {
      try {
        const repo = await api(`https://api.github.com/repos/${s.fullName}`);
        candidates.set(s.fullName, { repo, origin: 'core', core: true });
      } catch (e) { console.error(`  [核心源检查失败] ${s.fullName}: ${e.message}`); }
    }
    // 核心源始终参与，即使名称过滤未命中
    if (candidates.has(s.fullName)) candidates.get(s.fullName).core = true;
  }
  console.log(`  通过仓库级初筛: ${candidates.size} 个`);

  // 构造待验证源（复用历史路径可省去 tree API 调用）
  const pending = [];
  const rejected = [];
  for (const [fullName, c] of candidates) {
    const { repo, origin } = c;
    const core = c.core || CORE_SOURCES.some(x => x.fullName === fullName);
    const days = daysSince(repo.pushed_at);
    if (repo.archived) { rejected.push({ fullName, reason: '仓库已归档' }); continue; }
    if (!core) {
      if ((repo.stargazers_count || 0) < DISCOVERY.minStars) { rejected.push({ fullName, reason: `stars 不足 ${DISCOVERY.minStars}` }); continue; }
      if (days > DISCOVERY.maxInactiveDays) { rejected.push({ fullName, reason: `${days} 天无更新` }); continue; }
    }
    pending.push({ fullName, repo, origin, core, branch: c.branch, path: c.path });
  }

  // 探测路径 + 抓取验证（并发）
  console.log(`[验证] 抓取并校验 ${pending.length} 个候选订阅文件...`);
  const checked = await mapLimit(pending, 5, async c => {
    let branch = c.branch, filePath = c.path;
    if (!branch || !filePath) {
      const probed = await probePath(c.fullName, branch);
      if (probed.archived) return { ...c, error: '仓库已归档' };
      branch = probed.branch; filePath = probed.path;
    }
    if (!filePath) return { ...c, error: '未找到订阅文件' };
    const legacy = CORE_SOURCES.find(x => x.fullName === c.fullName);
    const urls = legacy ? [legacy.url, ...legacy.fallbacks] : urlsFor(c.fullName, branch, filePath);
    const source = {
      key: legacy?.key || sourceKey(c.fullName),
      id: legacy?.id,
      name: legacy?.name || c.fullName,
      fullName: c.fullName,
      branch, path: filePath, urls,
      origin: c.origin, core: c.core,
      stars: c.repo.stargazers_count || 0,
      pushedAt: c.repo.pushed_at,
      repoUrl: c.repo.html_url,
      description: c.repo.description || '',
    };
    try {
      const st = await validateSource(source);
      return { ...source, ...st, score: makeScore(c.repo, st.groups, c.origin), failCount: 0 };
    } catch (e) {
      return { ...source, error: e.message };
    }
  });

  const valid = checked.filter(x => !x.error);
  for (const x of checked.filter(x => x.error)) rejected.push({ fullName: x.fullName, reason: x.error });
  // 核心源抓取失败时保留上次记录，避免订阅池突然清空
  const prevMap = new Map((prev?.active || []).map(x => [x.fullName, x]));
  for (const x of checked.filter(x => x.error && x.core)) {
    const old = prevMap.get(x.fullName);
    if (old && old.urls) valid.push({ ...old, failCount: (old.failCount || 0) + 1, stale: true });
  }

  // 评分排序，核心源保底，按上限截取
  valid.sort((a, b) => (Number(b.core) - Number(a.core)) || (b.score - a.score));
  const active = valid.slice(0, DISCOVERY.maxSources);
  const overflow = valid.slice(DISCOVERY.maxSources);
  for (const x of overflow) rejected.push({ fullName: x.fullName, reason: `评分 ${x.score} 未进入前 ${DISCOVERY.maxSources}` });

  // 自动降级：上次活跃但本次不在 active 的源
  const activeNames = new Set(active.map(x => x.fullName));
  const inactive = [...(prev?.inactive || [])];
  const inactiveIdx = new Map(inactive.map((x, i) => [x.fullName, i]));
  for (const old of (prev?.active || [])) {
    if (activeNames.has(old.fullName)) continue;
    const reason = rejected.find(r => r.fullName === old.fullName)?.reason || '本周未通过筛选';
    const rec = { fullName: old.fullName, name: old.name, reason, lastSeen: old.lastSeen || prev.generatedAt, removedAt: new Date().toISOString() };
    if (inactiveIdx.has(old.fullName)) inactive[inactiveIdx.get(old.fullName)] = rec;
    else inactive.push(rec);
  }
  // 重新活跃的源从 inactive 中移除
  const finalInactive = inactive.filter(x => !activeNames.has(x.fullName));

  // 首次运行时核心源不算「新发现」（用户本来就在使用），只报告动态发现的新源
  const prevActiveNames = prev ? new Set((prev.active || []).map(x => x.fullName)) : new Set(CORE_SOURCES.map(x => x.fullName));
  const newSources = active.filter(x => !prevActiveNames.has(x.fullName));
  const droppedSources = finalInactive.filter(x => prevActiveNames.has(x.fullName));

  const registry = {
    generatedAt: new Date().toISOString(),
    active: active.map(x => ({ ...x, lastSeen: new Date().toISOString() })),
    inactive: finalInactive,
    discovery: {
      searched: searched.size,
      communitySeeds: seeds.size,
      candidates: candidates.size,
      validated: valid.length,
      rejected: rejected.slice(0, 60),
    },
  };
  writeFile(PATHS.sources, JSON.stringify(registry, null, 2));
  console.log(`[发现] 完成：活跃 ${active.length} 个，新增 ${newSources.length} 个，降级 ${droppedSources.length} 个，淘汰 ${rejected.length} 个`);
  for (const s of active) console.log(`  ✓ ${String(s.score).padStart(2)}分 ${s.name} (${s.fullName}) ${s.groups}组 ${s.stars}★${s.stale ? ' [缓存]' : ''}`);
  return { active: registry.active, newSources, droppedSources, registry };
}

function writeFile(rel, content) {
  const full = p(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}
