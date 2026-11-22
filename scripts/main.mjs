import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, OUTPUT_SUBSCRIPTION, REPO, PATHS } from './config.mjs';
import { fetchWithFallback, parseSubscription, stats } from './lib.mjs';

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
  lines.push('## 五、产物说明');
  lines.push('');
  lines.push('- `dist/unique_rules.json5`：三库去重精选订阅，只含跨库唯一规则，可直接导入 GKD（ID 990667）');
  lines.push('- `dist/merged.json5`：三库合并全量订阅，重复规则只保留一份，优先级 Lin-arm > 甘霖 > 奥怪（ID 990668）');
  lines.push('- `dist/unique_rules.version.json5`：更新检查文件');
  lines.push('');
  const rawUrl = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/main/`;
  lines.push('### 一键导入链接');
  lines.push('');
  lines.push('```txt');
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
  console.log(`产物: ${PATHS.uniqueRules}, ${PATHS.merged}, ${PATHS.report}`);
}

main().catch(e => { console.error(e); process.exit(1); });
