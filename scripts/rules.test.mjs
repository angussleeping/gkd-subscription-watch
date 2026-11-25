import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupFingerprint,
  groupScopeFingerprint,
  normalizeOutputGroups,
  parseSubscription,
} from './lib.mjs';
import { buildPrecise } from './precise.mjs';

const snapshots = ['https://i.gkd.li/i/12345678'];

function parsed(app) {
  return parseSubscription(JSON.stringify({ id: 1, name: 'test', version: 1, apps: [app] }));
}

function appWithGroup(group, enable = true) {
  return { id: 'com.example.app', name: 'Example', enable, groups: [group] };
}

test('规则指纹忽略展示元数据但保留完整行为字段', () => {
  const group = {
    key: 1,
    name: '开屏广告',
    activityIds: ['.MainActivity'],
    rules: [{
      key: 0,
      matches: ['[text="跳过"]'],
      preKeys: [],
      position: { left: 0 },
      matchDelay: 100,
    }],
  };
  const renamed = {
    ...group,
    name: '重命名',
    snapshotUrls: snapshots,
    rules: [{ ...group.rules[0], name: '规则别名', snapshotUrls: snapshots }],
  };
  assert.equal(groupFingerprint(group), groupFingerprint(renamed));

  const variants = [
    { ...group, matchTime: 2000 },
    { ...group, rules: [{ ...group.rules[0], preKeys: [1] }] },
    { ...group, rules: [{ ...group.rules[0], position: { left: 1 } }] },
    { ...group, rules: [{ ...group.rules[0], key: 2 }] },
  ];
  for (const variant of variants) assert.notEqual(groupFingerprint(group), groupFingerprint(variant));
});

test('组级适用范围指纹独立于规则内容', () => {
  const group = { name: '广告', activityIds: ['.Main'], matchTime: 1000, rules: [{ matches: ['A'] }] };
  assert.equal(groupScopeFingerprint(group), groupScopeFingerprint({
    ...group,
    name: '另一个名称',
    rules: [{ matches: ['B'] }],
  }));
  assert.notEqual(groupScopeFingerprint(group), groupScopeFingerprint({ ...group, matchTime: 2000 }));
  assert.notEqual(groupScopeFingerprint(group), groupScopeFingerprint({ ...group, activityIds: ['.Other'] }));
});

test('输出组 key 为连续整数且组名在应用内唯一', () => {
  const apps = normalizeOutputGroups([{
    id: 'com.example.app',
    groups: [
      { key: 'old-1', name: '广告', rules: [{ name: '规则', matches: ['A'] }, { name: '规则', matches: ['B'] }] },
      { key: 'old-2', name: '广告' },
      { key: 'old-3', name: '其他' },
    ],
  }]);
  assert.deepEqual(apps[0].groups.map(group => group.key), [1, 2, 3]);
  assert.deepEqual(apps[0].groups.map(group => group.name), ['广告', '广告 (2)', '其他']);
  assert.deepEqual(apps[0].groups[0].rules.map(rule => rule.name), ['规则', '规则 (2)']);
});

test('精准去重仅合并同快照且组级配置兼容的规则', () => {
  const a = parsed(appWithGroup({
    key: 1,
    name: '开屏广告',
    activityIds: ['.Main'],
    snapshotUrls: snapshots,
    rules: [{ matches: ['A'] }],
  }));
  const b = parsed(appWithGroup({
    key: 2,
    name: '开屏广告',
    activityIds: ['.Main'],
    snapshotUrls: snapshots,
    rules: [{ matches: ['B'] }],
  }));
  const result = buildPrecise({ a, b }, [{ key: 'a', score: 90 }, { key: 'b', score: 80 }]);
  assert.equal(result.apps[0].groups.length, 1);
  assert.equal(result.apps[0].groups[0].rules.length, 2);
  assert.equal(result.dedupCount, 1);
});

test('组级配置不同的同快照规则不会被拼接', () => {
  const makeApp = matchTime => appWithGroup({
    key: 1,
    name: '开屏广告',
    activityIds: ['.Main'],
    matchTime,
    snapshotUrls: snapshots,
    rules: [{ matches: [matchTime === 1000 ? 'A' : 'B'] }],
  });
  const result = buildPrecise(
    { a: parsed(makeApp(1000)), b: parsed(makeApp(2000)) },
    [{ key: 'a', score: 90 }, { key: 'b', score: 80 }],
  );
  assert.equal(result.apps[0].groups.length, 2);
  assert.equal(result.apps[0].groups.flatMap(group => group.rules).length, 2);
});

test('带规则 key 的不同组不会交叉合并', () => {
  const makeApp = selector => appWithGroup({
    key: 1,
    name: '开屏广告',
    snapshotUrls: snapshots,
    rules: [{ key: 1, matches: [selector] }],
  });
  const result = buildPrecise(
    { a: parsed(makeApp('A')), b: parsed(makeApp('B')) },
    [{ key: 'a', score: 90 }, { key: 'b', score: 80 }],
  );
  assert.equal(result.apps[0].groups.length, 2);
  for (const group of result.apps[0].groups) assert.equal(group.rules.length, 1);
});

test('精准去重保留上游应用禁用状态', () => {
  const sub = parsed(appWithGroup({ key: 1, name: '广告', rules: [{ matches: ['A'] }] }, false));
  const result = buildPrecise({ a: sub }, [{ key: 'a', score: 90 }]);
  assert.equal(result.apps[0].groups[0].enable, false);
});
