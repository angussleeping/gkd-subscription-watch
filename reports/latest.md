# GKD 全站动态订阅检测报告

生成时间：2026-11-25T11:14:17.504Z

## 一、本周源发现与自动降级

扫描 GitHub 仓库 **200** 个，社区名单种子 5 个，仓库级初筛 136 个，规则文件校验通过 13 个，最终纳入 **13** 个活跃源。

### 本周新增源（1）

| 订阅 | 仓库 | Stars | 规则组 | 独有规则 | 评分 |
|---|---|---|---|---|---|
| CKylinMC 补充规则 | CKylinMC/gkd-rule-extras | 38 | 37 | 37 | 38 |

## 二、活跃订阅状态

| 订阅 | ID | 版本 | 应用数 | 规则组 | 启用组 | 规则条目 | 评分 | 来源 |
|---|---|---|---|---|---|---|---|---|
| 甘霖 | 233 ⚠️ | 72 | 610 | 1389 | 104 | 1987 | 98 | 核心 |
| 奥怪 | 86 | 89 | 72 | 280 | 4 | 645 | 98 | 核心 |
| Lin-arm | 667 | 644 | 1012 | 2534 | 2530 | 3999 | 90 | 核心 |
| CKylinMC 补充规则 | 5506 | 26 | 30 | 37 | 37 | 43 | 38 | 核心 |
| MengNianxiaoyao/gkd-subscription | 1 | 79 | 285 | 870 | 59 | 1482 | 87 | GitHub发现 |
| Lin-arm/gkd-Rules | 777 | 130 | 33 | 195 | 117 | 462 | 78 | GitHub发现 |
| AIsouler/gkd-subscription | 404 | 124 | 76 | 240 | 240 | 328 | 75 | GitHub发现 |
| oklazeno/gkd-subscription | 72 | 1 | 1036 | 3337 | 2663 | 5206 | 65 | GitHub发现 |
| yanmuq/muqi_gkd | 808 | 54 | 35 | 117 | 16 | 164 | 65 | GitHub发现 |
| mrlctate/gkd-mrlc | 2 | 75 | 693 | 1505 | 69 | 2446 | 62 | GitHub发现 |
| LenorEric/GK-Lemon-D | 250 | 59 | 14 | 26 | 25 | 33 | 54 | GitHub发现 |
| cjy0812/Ling033_GKD_Rules | 233 ⚠️ | 16 | 12 | 41 | 41 | 69 | 53 | GitHub发现 |
| timyang2005/gkd-merged-subscription | 999001 | 2 | 886 | 2074 | 2074 | 3213 | 51 | GitHub发现 |

> ⚠️ 表示上游订阅 ID 撞号（不影响本仓库产物：三档订阅 ID 990667/990668/990669 独立且唯一）。

## 三、本周变化

> 指纹算法已升级，本周重新建立基线；历史规则不计为新增或删除。

## 四、本周新增且不重复的规则

> 新源首次纳入时，其存量规则会计入本周新增；下周起该数字才反映真实增量。

> 指纹算法升级，本周重建基线，暂不列出。

## 五、各源当前独有规则数

- 甘霖：601 条
- 奥怪：5 条
- Lin-arm：219 条
- CKylinMC 补充规则：37 条
- MengNianxiaoyao/gkd-subscription：79 条
- Lin-arm/gkd-Rules：188 条
- AIsouler/gkd-subscription：181 条
- oklazeno/gkd-subscription：117 条
- yanmuq/muqi_gkd：70 条
- mrlctate/gkd-mrlc：261 条
- LenorEric/GK-Lemon-D：26 条
- cjy0812/Ling033_GKD_Rules：40 条
- timyang2005/gkd-merged-subscription：289 条

## 六、精准去重结果（推荐）

基于「快照图片 ID + 语义组名」识别跨源的同一广告（即使选择器写法不同也能识别），共合并 **7209** 条重复规则。

| 产物 | 应用数 | 规则组数 | 说明 |
|---|---|---|---|
| 全站合并全量 | 1102 | 6150 | 仅按内容指纹去重 |
| 全站去重精选 | 634 | 2113 | 只保留跨源唯一规则 |
| **全站精准去重** | 1102 | 5436 | 语义级去重，推荐导入 |

精准去重策略：仅在组级配置兼容时合并同一广告的独有选择器，含组内规则引用的组完整独立保留；小米系统应用优先奥怪版本，其余按「热度 + 活跃度 + 规则规模」评分选保留源。

## 七、产物说明

- `dist/precise.json5`：**精准去重订阅（推荐）**，ID 990669
- `dist/unique_rules.json5`：去重精选订阅，ID 990667
- `dist/merged.json5`：合并全量订阅，ID 990668
- `dist/*.version.json5`：更新检查文件
- `data/sources.json`：动态源注册表（活跃/降级记录）

### 一键导入链接

```txt
https://raw.githubusercontent.com/angussleeping/gkd-subscription-watch/main/dist/precise.json5
https://raw.githubusercontent.com/angussleeping/gkd-subscription-watch/main/dist/unique_rules.json5
https://raw.githubusercontent.com/angussleeping/gkd-subscription-watch/main/dist/merged.json5
```
