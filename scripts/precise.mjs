import { SOURCES } from './config.mjs';
import { consolidateGroups, groupScopeFingerprint, normalizeGroupName, ruleFingerprint } from './lib.mjs';

// 判断是否为小米系统应用（这类应用优先保留奥怪的精简规则）
function isMiSystemApp(appId) {
  return appId.startsWith('com.miui.') || appId.startsWith('com.mi.') ||
         appId.startsWith('com.xiaomi.') || appId === 'com.android.thememanager';
}

// 从规则组提取快照数字ID（跨库稳定：i.gkd.li/i/13466647 与 import/13466647 数字相同）
function snapshotIds(group) {
  const rules = Array.isArray(group.rules) ? group.rules : [group.rules].filter(Boolean);
  const ids = new Set();
  for (const r of rules) {
    if (!r) continue;
    const s = r.snapshotUrls || r.snapshotUrl;
    if (!s) continue;
    for (const u of (Array.isArray(s) ? s : [s])) {
      const m = String(u).match(/(\d{6,})/);
      if (m) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

// 带规则 key 或关联字段的组只按完整指纹去重，避免跨组合并破坏组内引用。
function hasRuleKeys(group) {
  const rules = Array.isArray(group.rules) ? group.rules : [group.rules].filter(Boolean);
  return rules.some(r => r && typeof r === 'object' && (
    r.key !== undefined || r.preKeys !== undefined ||
    r.actionCdKey !== undefined || r.actionMaximumKey !== undefined
  ));
}

// 库优先级：小米系统应用奥怪优先，其余按动态评分（热度+活跃度+规则规模）排序
function makeRankFn(sources) {
  const byKey = new Map(sources.map(s => [s.key, s]));
  return (sourceKey, appId) => {
    if (isMiSystemApp(appId)) {
      if (sourceKey === 'aoguai' && byKey.has('aoguai')) return 0;
      if (sourceKey === 'linarm' && byKey.has('linarm')) return 1;
      if (sourceKey === 'ganlin' && byKey.has('ganlin')) return 2;
    }
    const s = byKey.get(sourceKey);
    return s ? 100 - Math.min(90, s.score || 0) : 99;
  };
}

// 主入口：subs = { sourceKey: parsedSubscription }, sources = 本周动态活跃源清单
export function buildPrecise(subs, sources = SOURCES) {
  const rank = makeRankFn(sources);
  // 全局规则语义表：语义键 -> [{sourceKey, appId, group}]
  const buckets = new Map();

  for (const s of sources) {
    const sub = subs[s.key];
    if (!sub) continue;
    for (const [appId, app] of sub.apps) {
      for (const g of app.groups) {
        const snaps = snapshotIds(g.raw);
        const keys = [];
        if (snaps.length > 0) {
          // 主语义键：每个快照ID都是入口，任一同ID即视为同一广告
          for (const sid of snaps) keys.push(`snap:${appId}:${sid}`);
        } else {
          const norm = normalizeGroupName(g.name);
          if (norm) keys.push(`name:${appId}:${norm}`);
          else keys.push(`raw:${appId}:${g.fingerprint}`);
        }
        for (const k of keys) {
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push({ sourceKey: s.key, appId, appName: app.name, appEnable: app.enable, group: g });
        }
      }
    }
  }

  // 合并：一个语义键可能关联多个原始组，做并集去重
  const mergedApps = new Map();
  let dedupCount = 0;
  let mergedGroups = 0;

  // 按语义键聚类，但需处理"一个组有多个快照ID"导致的跨桶关联：用并查集合并
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const k of buckets.keys()) if (!parent.has(k)) parent.set(k, k);
  // 同一规则组产生的多个快照键属于同一簇
  for (const s of sources) {
    const sub = subs[s.key];
    if (!sub) continue;
    for (const [appId, app] of sub.apps) {
      for (const g of app.groups) {
        const snaps = snapshotIds(g.raw);
        if (snaps.length > 1) {
          const first = `snap:${appId}:${snaps[0]}`;
          for (let i = 1; i < snaps.length; i++) union(first, `snap:${appId}:${snaps[i]}`);
        }
      }
    }
  }

  // 收集每个簇的所有规则组
  const clusters = new Map(); // root -> Set of {sourceKey, appId, appName, group}
  for (const [k, list] of buckets) {
    const root = find(k);
    if (!clusters.has(root)) clusters.set(root, []);
    for (const item of list) {
      if (!clusters.get(root).some(x => x.sourceKey === item.sourceKey && x.group === item.group)) {
        clusters.get(root).push(item);
      }
    }
  }

  for (const list of clusters.values()) {
    const appId = list[0].appId;
    const appName = list[0].appName;

    // 只在组级配置一致时合并规则；含组内引用的组必须完整保留。
    const compatibleBuckets = new Map();
    for (const item of list) {
      const scope = groupScopeFingerprint(item.group.raw);
      const compatibilityKey = hasRuleKeys(item.group.raw)
        ? `${scope}:${item.group.fingerprint}`
        : scope;
      if (!compatibleBuckets.has(compatibilityKey)) compatibleBuckets.set(compatibilityKey, []);
      compatibleBuckets.get(compatibilityKey).push(item);
    }

    for (const compatibleList of compatibleBuckets.values()) {
      const sorted = [...compatibleList].sort((a, b) => rank(a.sourceKey, appId) - rank(b.sourceKey, appId));
      const keeper = sorted[0];
      dedupCount += sorted.length - 1;

      const base = keeper.group.raw;
      const rules = Array.isArray(base.rules) ? [...base.rules] : (base.rules ? [base.rules] : []);
      const seenRules = new Set(rules.map(ruleFingerprint));
      for (const item of sorted.slice(1)) {
        const other = item.group.raw;
        const otherRules = Array.isArray(other.rules) ? other.rules : (other.rules ? [other.rules] : []);
        for (const r of otherRules) {
          const fp = ruleFingerprint(r);
          if (!seenRules.has(fp)) { rules.push(r); seenRules.add(fp); }
        }
      }
      mergedGroups++;

      if (!mergedApps.has(appId)) mergedApps.set(appId, { id: appId, name: appName, enable: true, groups: [] });
      const outGroup = { ...base };
      outGroup.key = `${keeper.sourceKey}-${keeper.group.key ?? 0}`;
      outGroup.name = keeper.group.name || base.name || '';
      outGroup.enable = keeper.group.enable && keeper.appEnable;
      outGroup.rules = rules;
      mergedApps.get(appId).groups.push(outGroup);
    }
  }

  // 名称级二次合并：各源对同一广告的规则集常略有差异（选择器补丁、key 编号不同），
  // 仅靠快照+范围指纹仍会留下同名重复组，这里按“同应用同名”再合并一次。
  const consolidated = consolidateGroups([...mergedApps.values()]);

  // 补充：完全没有任何语义键的组（理论上不存在，防御性）
  return {
    apps: consolidated.apps,
    dedupCount,
    mergedGroups,
    consolidatedCount: consolidated.removedGroups,
  };
}
