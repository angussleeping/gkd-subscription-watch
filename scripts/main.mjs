import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, OUTPUT_SUBSCRIPTION, REPO, PATHS } from './config.mjs';
import { fetchWithFallback, parseSubscription, stats } from './lib.mjs';
import { buildPrecise } from './precise.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = rel => path.join(ROOT, rel);

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(p(file), 'utf8')); }
  catch { return fallback; }
}

function writeFile(rel, content) {
  const full = p(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function groupKey(appId, fp) { return `${appId}|${fp}`; }

function nowISO() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

async function main() {
  console.log(`[${nowISO()}] 开始检测三个订阅源...`);

  // 1. 抓取并解析
  const subs = {};
  for (const s of SOURCES) {
    console.log(`抓取 ${s.name}...`);
    const { url, text } = await fetchWithFallback([s.url, ...s.fallbacks]);
    console.log(`  成功: ${url} (${(text.length / 1024).toFixed(0)} KB)`);
    subs[s.key] = parseSubscription(text);
  }

  // 2. 构建全局指纹索引：fingerprint -> 出现在哪些库
  const fingerprintSources = new Map(); // key -> Set<sourceKey>
  for (const s of SOURCES) {
    const sub = subs[s.key];
    for (const [appId, app] of sub.apps) {
      for (const g of app.groups) {
        const k = groupKey(appId, g.fingerprint);
        if (!fingerprintSources.has(k)) fingerprintSources.set(k, new Set());
        fingerprintSources.get(k).add(s.key);
      }
    }
  }

  // 3. 读取基线
  const baseline = readJSON(PATHS.baseline, null);
  const isFirstRun = !baseline;

  // 4. 计算每库的变化
  const changes = {};
  for (const s of SOURCES) {
    const sub = subs[s.key];
    const currentKeys = new Set();
    for (const [appId, app] of sub.apps) {
      for (const g of app.groups) currentKeys.add(groupKey(appId, g.fingerprint));
    }
    const prevKeys = new Set((baseline?.sources?.[s.key]?.groups) || []);
    const added = [...currentKeys].filter(k => !prevKeys.has(k));
    const removed = [...prevKeys].filter(k => !currentKeys.has(k));
    changes[s.key] = { added, removed, current: [...currentKeys] };
  }

  // 5. 找出"新增且跨库唯一"的规则（本周真正有价值的增量）
  const newUnique = [];
  for (const s of SOURCES) {
    const sub = subs[s.key];
    for (const k of changes[s.key].added) {
      const sources = fingerprintSources.get(k) || new Set();
      if (sources.size === 1) {
        const [appId] = k.split('|');
        const app = sub.apps.get(appId);
        const g = app?.groups.find(g => groupKey(appId, g.fingerprint) === k);
        if (g) newUnique.push({ source: s.name, sourceKey: s.key, appId, appName: app.name, groupName: g.name });
      }
    }
  }

  // 6. 统计各库当前独有规则数
  const uniqueCounts = {};
  for (const s of SOURCES) {
    uniqueCounts[s.key] = 0;
    for (const [k, sources] of fingerprintSources) {
      if (sources.size === 1 && sources.has(s.key)) uniqueCounts[s.key]++;
    }
  }

  // 7. 生成去重精选订阅：仅保留跨库唯一的规则组
  const uniqueApps = new Map();
  for (const s of SOURCES) {
    const sub = subs[s.key];
    for (const [appId, app] of sub.apps) {
      for (const g of app.groups) {
        const k = groupKey(appId, g.fingerprint);
        if (fingerprintSources.get(k)?.size !== 1) continue;
        if (!uniqueApps.has(appId)) uniqueApps.set(appId, { id: appId, name: app.name, enable: true, groups: [] });
        const raw = { ...g.raw };
        delete raw.key;
        uniqueApps.get(appId).groups.push({ key: `${s.key}-${g.key ?? 0}`, ...raw, enable: g.enable && app.enable });
      }
    }
  }
  const uniqueSub = {
    id: OUTPUT_SUBSCRIPTION.id,
    name: OUTPUT_SUBSCRIPTION.name,
    version: Number(today().replace(/-/g, '')),
    author: OUTPUT_SUBSCRIPTION.author,
    checkUpdateUrl: OUTPUT_SUBSCRIPTION.checkUpdateUrl,
    apps: [...uniqueApps.values()],
  };
  writeFile(PATHS.uniqueRules, JSON.stringify(uniqueSub));
  writeFile(PATHS.uniqueVersion, JSON.stringify({ id: OUTPUT_SUBSCRIPTION.id, version: uniqueSub.version }));

  // 8. 生成合并订阅：全部规则按指纹去重，优先级 Lin-arm > 甘霖 > 奥怪
  const mergedApps = new Map();
  const seen = new Set();
  for (const s of SOURCES) {
    const sub = subs[s.key];
    for (const [appId, app] of sub.apps) {
      for (const g of app.groups) {
        const k = groupKey(appId, g.fingerprint);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!mergedApps.has(appId)) mergedApps.set(appId, { id: appId, name: app.name, enable: true, groups: [] });
        const raw = { ...g.raw };
        delete raw.key;
        mergedApps.get(appId).groups.push({ key: `${s.key}-${g.key ?? 0}`, ...raw, enable: g.enable && app.enable });
      }
    }
  }
  const mergedSub = {
    id: OUTPUT_SUBSCRIPTION.id + 1,
    name: 'GKD 三库合并全量',
    version: uniqueSub.version,
    author: OUTPUT_SUBSCRIPTION.author,
    apps: [...mergedApps.values()],
  };
  writeFile(PATHS.merged, JSON.stringify(mergedSub));

  // 8.5 精准去重：基于快照ID+语义名的跨库同广告识别，保留最优库并合并独有选择器
  const preciseResult = buildPrecise(subs);
  const preciseSub = {
    id: OUTPUT_SUBSCRIPTION.id + 2,
    name: 'GKD 三库精准去重',
    version: uniqueSub.version,
    author: OUTPUT_SUBSCRIPTION.author,
    checkUpdateUrl: './precise.version.json5',
    apps: preciseResult.apps,
  };
  writeFile(PATHS.preciseRules, JSON.stringify(preciseSub));
  writeFile(PATHS.preciseVersion, JSON.stringify({ id: preciseSub.id, version: preciseSub.version }));

  // 9. 生成报告
  const lines = [];
  lines.push(`# GKD 三库订阅检测报告`);
  lines.push('');
  lines.push(`生成时间：${nowISO()}`);
  lines.push('');
  lines.push('## 一、订阅状态');
  lines.push('');
  lines.push('| 订阅 | ID | 版本 | 应用数 | 规则组 | 启用组 | 规则条目 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of SOURCES) {
    const st = stats(subs[s.key]);
    lines.push(`| ${s.name} | ${s.id} | ${st.version} | ${st.apps} | ${st.groups} | ${st.enabledGroups} | ${st.ruleItems} |`);
  }
  lines.push('');
  lines.push('## 二、本周变化');
  lines.push('');
  if (isFirstRun) {
    lines.push('> 首次运行，已建立基线快照。下周起将报告精确的新增/删除规则。');
  } else {
    lines.push('| 订阅 | 新增规则组 | 删除规则组 |');
    lines.push('|---|---|---|');
    for (const s of SOURCES) {
      lines.push(`| ${s.name} | ${changes[s.key].added.length} | ${changes[s.key].removed.length} |`);
    }
  }
  lines.push('');
  lines.push('## 三、本周新增且不重复的规则');
  lines.push('');
  if (newUnique.length === 0) {
    lines.push(isFirstRun ? '> 首次运行无对比基线，暂不列出。' : '本周无新增的独有规则。');
  } else {
    lines.push(`共 ${newUnique.length} 条来自单一库的新规则（其他两库均无相同规则）：`);
    lines.push('');
    for (const item of newUnique.slice(0, 100)) {
      lines.push(`- **${item.source}** · ${item.appName || item.appId} · ${item.groupName || '未命名规则组'} \`${item.appId}\``);
    }
    if (newUnique.length > 100) lines.push(`- ...另有 ${newUnique.length - 100} 条，见去重订阅文件`);
  }
  lines.push('');
  lines.push('## 四、各库当前独有规则数');
  lines.push('');
  for (const s of SOURCES) {
    lines.push(`- ${s.name}：${uniqueCounts[s.key]} 条`);
  }
  lines.push('');
  const preciseGroups = preciseResult.apps.reduce((s, a) => s + a.groups.length, 0);
  lines.push('## 五、精准去重结果（推荐）');
  lines.push('');
  lines.push(`基于「快照图片 ID + 语义组名」识别跨库的同一广告规则（即使选择器写法不同也能识别），共合并 **${preciseResult.dedupCount}** 条重复规则。`);
  lines.push('');
  lines.push('| 产物 | 应用数 | 规则组数 | 说明 |');
  lines.push('|---|---|---|---|');
  lines.push(`| 三库合并全量 | ${mergedApps.size} | ${mergedSub.apps.reduce((s, a) => s + a.groups.length, 0)} | 仅按内容指纹去重 |`);
  lines.push(`| 三库去重精选 | ${uniqueApps.size} | ${uniqueSub.apps.reduce((s, a) => s + a.groups.length, 0)} | 只保留跨库唯一规则 |`);
  lines.push(`| **三库精准去重** | ${preciseResult.apps.length} | ${preciseGroups} | 语义级去重，推荐导入 |`);
  lines.push('');
  lines.push('精准去重策略：同一广告（跨库快照 ID 相同或语义名相同）只保留一份，小米系统应用优先保留奥怪版本、其余优先 Lin-arm，并合并各库独有选择器以防漏杀。');
  lines.push('');
  lines.push('## 六、产物说明');
  lines.push('');
  lines.push('- `dist/precise.json5`：**精准去重订阅（推荐）**，语义级去重后一份，可直接导入 GKD（ID 990669）');
  lines.push('- `dist/unique_rules.json5`：三库去重精选订阅，只含跨库唯一规则（ID 990667）');
  lines.push('- `dist/merged.json5`：三库合并全量订阅，仅按内容指纹去重（ID 990668）');
  lines.push('- `dist/*.version.json5`：各订阅的更新检查文件');
  lines.push('');
  const rawUrl = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/main/`;
  lines.push('### 一键导入链接');
  lines.push('');
  lines.push('```txt');
  lines.push(rawUrl + PATHS.preciseRules);
  lines.push(rawUrl + PATHS.uniqueRules);
  lines.push(rawUrl + PATHS.merged);
  lines.push('```');
  lines.push('');
  writeFile(PATHS.report, lines.join('\n'));
  writeFile(`${PATHS.reportArchiveDir}/${today()}.md`, lines.join('\n'));

  // 10. 更新基线
  const newBaseline = {
    generatedAt: nowISO(),
    sources: {},
  };
  for (const s of SOURCES) {
    newBaseline.sources[s.key] = {
      version: subs[s.key].version,
      groups: changes[s.key].current,
    };
  }
  writeFile(PATHS.baseline, JSON.stringify(newBaseline, null, 2));
  writeFile(PATHS.changed, JSON.stringify({
    date: today(),
    isFirstRun,
    changed: isFirstRun || newUnique.length > 0 || SOURCES.some(s => changes[s.key].added.length > 0 || changes[s.key].removed.length > 0),
    newUnique: newUnique.length,
    added: Object.fromEntries(SOURCES.map(s => [s.key, changes[s.key].added.length])),
    removed: Object.fromEntries(SOURCES.map(s => [s.key, changes[s.key].removed.length])),
  }, null, 2));

  console.log('\n=== 完成 ===');
  console.log(`新增独有规则: ${newUnique.length}`);
  for (const s of SOURCES) console.log(`${s.name}: +${changes[s.key].added.length} / -${changes[s.key].removed.length}`);
  console.log(`精准去重: 合并 ${preciseResult.dedupCount} 条重复, 产出 ${preciseSub.apps.reduce((s, a) => s + a.groups.length, 0)} 组`);
  console.log(`产物: ${PATHS.preciseRules}, ${PATHS.uniqueRules}, ${PATHS.merged}, ${PATHS.report}`);
}

main().catch(e => { console.error(e); process.exit(1); });
