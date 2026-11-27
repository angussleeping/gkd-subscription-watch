import crypto from 'node:crypto';
import JSON5 from 'json5';

// 递归规范化：数组排序、对象键排序，用于生成稳定的内容指纹
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    // 数组按序列化结果排序，消除顺序差异
    return items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const v = canonicalize(value[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export function hash(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
    .slice(0, 16);
}

export const FINGERPRINT_VERSION = 2;

// 仅忽略展示元数据，保留所有可能影响匹配或执行行为的字段。
function normalizeRule(rule) {
  if (typeof rule === 'string') return { selector: rule };
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return rule;
  const { name, desc, enable, order, snapshotUrls, exampleUrls, ...core } = rule;
  return {
    ...core,
    activityIds: rule.activityIds || [],
    excludeActivityIds: rule.excludeActivityIds || [],
    matches: rule.matches || [],
    excludeMatches: rule.excludeMatches || [],
  };
}

// GKD 允许 rules 为对象数组，也允许简写为单个选择器字符串。
function normalizeRules(rules) {
  if (rules === undefined || rules === null) return [];
  const items = typeof rules === 'string' || !Array.isArray(rules) ? [rules] : rules;
  return items.map(normalizeRule);
}

// 组级配置决定其中规则的适用范围，不同配置不能安全地交叉合并规则。
export function groupScopeFingerprint(group) {
  const { key, name, desc, enable, order, snapshotUrls, exampleUrls, rules, ...core } = group;
  return hash({
    ...core,
    activityIds: group.activityIds || [],
    excludeActivityIds: group.excludeActivityIds || [],
  });
}

// 提取规则组完整逻辑指纹，忽略名称、组 key、顺序和快照链接等元数据。
export function groupFingerprint(group) {
  const { key, name, desc, enable, order, snapshotUrls, exampleUrls, rules, ...core } = group;
  return hash({
    ...core,
    activityIds: group.activityIds || [],
    excludeActivityIds: group.excludeActivityIds || [],
    rules: normalizeRules(rules),
  });
}

export function ruleFingerprint(rule) {
  return hash(normalizeRule(rule));
}

// 规则内容指纹：忽略展示元数据与组内 key 引用，用于跨库识别“同一动作”。
// 不同源的 key 编号往往不同，但选择器与执行行为一致时应视为同一条规则。
export function ruleContentFingerprint(rule) {
  if (typeof rule === 'string') return hash({ selector: rule });
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return hash(rule);
  const {
    name, desc, enable, order, snapshotUrls, exampleUrls, snapshotUrl,
    key, preKeys, actionCdKey, actionMaximumKey, ...core
  } = rule;
  return hash({
    ...core,
    activityIds: rule.activityIds || [],
    excludeActivityIds: rule.excludeActivityIds || [],
    matches: rule.matches || [],
    excludeMatches: rule.excludeMatches || [],
  });
}

// 组名规范化：去掉版本序号、括号补充与分隔符，用于识别同名规则组。
export function normalizeGroupName(name) {
  if (!name) return '';
  return name
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\-—－_:：]/g, '')
    .trim();
}

// 去掉名称末尾的 (2)/(3) 等版本后缀，得到干净组名。
export function stripGroupNameSuffix(name) {
  return String(name || '').replace(/\s*[（(]\s*\d+\s*[）)]\s*$/, '').trim();
}

// 组级行为指纹：忽略名称、顺序、快照等元数据，忽略可安全并集的适用范围，
// 也忽略 actionMaximum/matchTime 等时序调参（合并时统一取保留组配置）。
// 只保留 matchRoot 这类会改变选择器解析语义的字段，避免破坏匹配。
const BEHAVIOR_IGNORED = new Set([
  'key', 'name', 'desc', 'enable', 'order', 'snapshotUrls', 'exampleUrls', 'rules',
  'activityIds', 'excludeActivityIds',
  'fastQuery', 'actionMaximum', 'actionCd', 'actionDelay', 'actionMaximumKey', 'actionCdKey',
  'resetMatch', 'matchTime', 'forcedTime', 'priorityTime', 'priorityActionMaximum',
]);
export function groupBehaviorFingerprint(group) {
  const core = {};
  for (const [key, value] of Object.entries(group || {})) {
    if (!BEHAVIOR_IGNORED.has(key)) core[key] = value;
  }
  return hash(core);
}

function groupRuleList(group) {
  const r = group && group.rules;
  if (r === undefined || r === null) return [];
  return Array.isArray(r) ? r : [r];
}

function unionStringList(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (value === undefined || value === null) continue;
    for (const item of (Array.isArray(value) ? value : [value])) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  if (out.length === 0) return undefined;
  return out.length === 1 ? out[0] : out;
}

function mergeUrlField(target, source, field) {
  if (!target || !source || !source[field]) return;
  const list = [...(target[field] ? (Array.isArray(target[field]) ? target[field] : [target[field]]) : [])];
  for (const url of (Array.isArray(source[field]) ? source[field] : [source[field]])) {
    if (!list.includes(url)) list.push(url);
  }
  target[field] = list.length === 1 ? list[0] : list;
}

// key 引用重映射：合并后规则 key 可能被重新编号，preKeys 等引用需同步。
function remapKeyRefs(rule, keyMap) {
  if (!mapHasKey(keyMap)) return;
  for (const field of ['preKeys', 'actionCdKey', 'actionMaximumKey']) {
    const value = rule[field];
    if (Array.isArray(value)) {
      rule[field] = value.map(k => keyMap.has(k) ? keyMap.get(k) : k);
    } else if (typeof value === 'number' && keyMap.has(value)) {
      rule[field] = keyMap.get(value);
    }
  }
}

function mapHasKey(keyMap) {
  return keyMap && keyMap.size > 0;
}

// 同一条规则被多源重复提供时，合并其前置引用与快照证据，避免丢失触发路径。
function mergeDuplicateRule(target, source, keyMap) {
  if (!target || !source) return;
  if (typeof target.key === 'number' && Array.isArray(source.preKeys)) {
    const mapped = source.preKeys.map(k => keyMap.has(k) ? keyMap.get(k) : k);
    const current = Array.isArray(target.preKeys) ? [...target.preKeys] : [];
    for (const k of mapped) if (!current.includes(k)) current.push(k);
    if (current.length) target.preKeys = current.sort((a, b) => a - b);
  }
  mergeUrlField(target, source, 'snapshotUrls');
  mergeUrlField(target, source, 'exampleUrls');
}

// 合并多组规则：按内容去重，冲突的 key 重新编号并修正 preKeys 等引用。
function mergeRuleGroups(groups) {
  const result = [];
  const contentIndex = new Map();
  const usedKeys = new Set();
  let nextKey = 0;
  for (const group of groups) {
    for (const rule of groupRuleList(group)) {
      if (rule && typeof rule === 'object' && typeof rule.key === 'number') {
        nextKey = Math.max(nextKey, rule.key + 1);
      }
    }
  }

  for (const group of groups) {
    const rules = groupRuleList(group);
    const plan = [];
    for (const rule of rules) {
      const fp = ruleContentFingerprint(rule);
      const existing = contentIndex.get(fp);
      if (existing !== undefined) {
        plan.push({ rule, fp, dup: true, existing });
        continue;
      }
      let key;
      if (rule && typeof rule === 'object' && typeof rule.key === 'number') {
        key = usedKeys.has(rule.key) ? nextKey++ : rule.key;
      }
      plan.push({ rule, fp, dup: false, key });
    }

    const keyMap = new Map();
    for (const item of plan) {
      const rule = item.rule;
      if (!rule || typeof rule !== 'object' || typeof rule.key !== 'number') continue;
      if (item.dup) {
        const target = result[item.existing];
        if (target && typeof target.key === 'number') keyMap.set(rule.key, target.key);
      } else {
        keyMap.set(rule.key, item.key);
      }
    }

    for (const item of plan) {
      if (item.dup) {
        mergeDuplicateRule(result[item.existing], item.rule, keyMap);
        continue;
      }
      const cloned = structuredClone(item.rule);
      if (cloned && typeof cloned === 'object' && typeof cloned.key === 'number') {
        cloned.key = item.key;
        usedKeys.add(item.key);
      }
      if (cloned && typeof cloned === 'object') remapKeyRefs(cloned, keyMap);
      result.push(cloned);
      contentIndex.set(item.fp, result.length - 1);
    }
  }
  return result;
}

// 将一批同名规则组合并为一组：并集适用范围、并集规则、任一启用即启用。
function mergeSameNameGroups(groups) {
  const keeper = [...groups].sort((a, b) =>
    (Number(b.enable) - Number(a.enable)) || (groupRuleList(b).length - groupRuleList(a).length)
  )[0];

  const nameCount = new Map();
  for (const group of groups) {
    const name = stripGroupNameSuffix(group.name) || '未命名规则组';
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
  }
  const outName = [...nameCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];

  const out = { ...keeper };
  out.name = outName;
  out.enable = groups.some(group => group.enable);

  const activityIds = unionStringList(groups.map(group => group.activityIds));
  const excludeActivityIds = unionStringList(groups.map(group => group.excludeActivityIds));
  if (activityIds === undefined) delete out.activityIds; else out.activityIds = activityIds;
  if (excludeActivityIds === undefined) delete out.excludeActivityIds; else out.excludeActivityIds = excludeActivityIds;

  out.rules = mergeRuleGroups(groups);
  return out;
}

// 名称级二次合并：同一应用内同名规则组视为同一用途，合并规则并去重。
// 仅在组级行为配置一致时合并，避免把 actionMaximum/matchTime 等语义不同的组合到一起。
export function consolidateGroups(apps) {
  let removedGroups = 0;
  for (const app of apps) {
    const clusters = new Map();
    const passthrough = [];
    for (const group of app.groups) {
      const nameKey = normalizeGroupName(group.name);
      if (!nameKey) { passthrough.push(group); continue; }
      const key = `${nameKey}|${groupBehaviorFingerprint(group)}`;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(group);
    }

    const groups = [...passthrough];
    for (const list of clusters.values()) {
      if (list.length === 1) { groups.push(list[0]); continue; }
      removedGroups += list.length - 1;
      groups.push(mergeSameNameGroups(list));
    }
    app.groups = groups;
  }
  return { apps, removedGroups };
}

// GKD 要求组 key 为整数且全局唯一，同一应用内的组名也不能重复。
export function normalizeOutputGroups(apps) {
  let nextKey = 1;
  for (const app of apps) {
    const names = new Set();
    for (const group of app.groups) {
      group.key = nextKey++;
      const baseName = group.name || '未命名规则组';
      let name = baseName;
      let suffix = 2;
      while (names.has(name)) name = `${baseName} (${suffix++})`;
      group.name = name;
      names.add(name);

      const ruleNames = new Set();
      const rules = Array.isArray(group.rules) ? group.rules : [group.rules].filter(Boolean);
      for (const rule of rules) {
        if (!rule || typeof rule !== 'object' || !rule.name) continue;
        const baseRuleName = rule.name;
        let ruleName = baseRuleName;
        let ruleSuffix = 2;
        while (ruleNames.has(ruleName)) ruleName = `${baseRuleName} (${ruleSuffix++})`;
        rule.name = ruleName;
        ruleNames.add(ruleName);
      }
    }
  }
  return apps;
}

export function parseSubscription(raw) {
  const data = JSON5.parse(raw);
  const apps = new Map();
  let groupCount = 0;
  for (const app of data.apps || []) {
    const groups = app.groups || [];
    groupCount += groups.length;
    apps.set(app.id, {
      id: app.id,
      name: app.name || '',
      enable: app.enable !== false,
      groups: groups.map(g => ({
        key: g.key,
        name: g.name || '',
        enable: g.enable !== false,
        fingerprint: groupFingerprint(g),
        raw: g,
      })),
    });
  }
  return {
    id: data.id,
    name: data.name || '',
    version: data.version || 0,
    apps,
    groupCount,
  };
}

// 抓取带重试与备用源
export async function fetchWithFallback(urls, timeoutMs = 30000) {
  let lastErr;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'gkd-subscription-watch/1.0' },
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      if (text.length < 1000) throw new Error('响应内容过短，疑似错误页');
      return { url, text };
    } catch (e) {
      lastErr = e;
      console.error(`  [抓取失败] ${url}: ${e.message}`);
    }
  }
  throw lastErr || new Error('所有订阅源均不可用');
}

// 规则条目数（兼容字符串简写与对象数组）
export function ruleCount(raw) {
  const r = raw.rules;
  if (!r) return 0;
  if (typeof r === 'string') return 1;
  if (Array.isArray(r)) return r.length;
  return 1;
}

// 统计订阅
export function stats(sub) {
  let enabledGroups = 0;
  let ruleItems = 0;
  for (const app of sub.apps.values()) {
    for (const g of app.groups) {
      if (g.enable && app.enable) enabledGroups++;
      ruleItems += ruleCount(g.raw);
    }
  }
  return {
    version: sub.version,
    apps: sub.apps.size,
    groups: sub.groupCount,
    enabledGroups,
    ruleItems,
  };
}
