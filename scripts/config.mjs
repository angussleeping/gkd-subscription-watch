// 订阅源配置
export const SOURCES = [
  {
    key: 'linarm',
    id: 667,
    name: 'Lin-arm',
    url: 'https://raw.githubusercontent.com/Lin-arm/GKD_subscription/main/dist/gkd.json5',
    // 备用源：主源失败时依次尝试
    fallbacks: [
      'https://jsd.admincdn.com/gh/Lin-arm/GKD_subscription@main/dist/gkd.json5',
      'https://cdn.jsdelivr.net/gh/Lin-arm/GKD_subscription@main/dist/gkd.json5',
    ],
  },
  {
    key: 'ganlin',
    id: 233,
    name: '甘霖',
    url: 'https://raw.githubusercontent.com/ganlinte/GKD-subscription/main/dist/ganlin_gkd.json5',
    fallbacks: [
      'https://registry.npmmirror.com/@ganlinte/gkd-subscription/latest/files',
    ],
  },
  {
    key: 'aoguai',
    id: 86,
    name: '奥怪',
    url: 'https://raw.githubusercontent.com/aoguai/subscription/custom/dist/aoguai_gkd.json5',
    fallbacks: [
      'https://cdn.jsdelivr.net/gh/aoguai/subscription@custom/dist/aoguai_gkd.json5',
      'https://registry.npmmirror.com/@aoguai/subscription/latest/files/dist/aoguai_gkd.json5',
    ],
  },
];

// 生成的去重订阅标识（需与现有订阅不冲突）
export const OUTPUT_SUBSCRIPTION = {
  id: 990667,
  name: 'GKD 三库去重精选',
  author: 'gkd-subscription-watch',
  // 相对路径更新检查文件，配合 dist/unique_rules.version.json5 使用
  checkUpdateUrl: './unique_rules.version.json5',
};

export const REPO = {
  owner: 'angussleeping',
  name: 'gkd-subscription-watch',
};

export const PATHS = {
  baseline: 'data/baseline.json',
  changed: 'data/changed.json',
  uniqueRules: 'dist/unique_rules.json5',
  uniqueVersion: 'dist/unique_rules.version.json5',
  merged: 'dist/merged.json5',
  preciseRules: 'dist/precise.json5',
  preciseVersion: 'dist/precise.version.json5',
  report: 'reports/latest.md',
  reportArchiveDir: 'reports',
};
