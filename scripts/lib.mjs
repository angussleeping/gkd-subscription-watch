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
