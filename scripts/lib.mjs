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

// 规范化 rules：GKD 允许 rules 为对象数组，也允许简写为单个选择器字符串
function normalizeRules(rules) {
  if (rules === undefined || rules === null) return [];
  if (typeof rules === 'string') return [{ selector: rules }];
  if (!Array.isArray(rules)) return [rules];
  return rules.map(r => {
    if (typeof r === 'string') return { selector: r };
    if (!r || typeof r !== 'object') return r;
    return {
      action: r.action,
      matches: r.matches || [],
      excludeMatches: r.excludeMatches || [],
      ...(r.selector ? { selector: r.selector } : {}),
    };
  });
}

// 提取一个规则组的核心匹配指纹（忽略名称、key、order、快照URL等非逻辑字段）
export function groupFingerprint(group) {
  const core = {
    activityIds: group.activityIds || [],
    excludeActivityIds: group.excludeActivityIds || [],
    rules: normalizeRules(group.rules),
  };
  return hash(core);
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
