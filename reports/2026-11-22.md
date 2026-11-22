# GKD 全站动态订阅检测报告

生成时间：2026-11-22T08:58:20.169Z

## 一、本周源发现与自动降级

扫描 GitHub 仓库 **199** 个，社区名单种子 5 个，仓库级初筛 135 个，规则文件校验通过 12 个，最终纳入 **12** 个活跃源。

本周未发现符合门槛的新源。

## 二、活跃订阅状态

| 订阅 | ID | 版本 | 应用数 | 规则组 | 启用组 | 规则条目 | 评分 | 来源 |
|---|---|---|---|---|---|---|---|---|
| 甘霖 | 233 ⚠️ | 72 | 610 | 1389 | 104 | 1987 | 98 | 核心 |
| 奥怪 | 86 | 89 | 72 | 280 | 4 | 645 | 98 | 核心 |
| Lin-arm | 667 | 641 | 1009 | 2527 | 2523 | 3988 | 90 | 核心 |
| MengNianxiaoyao/gkd-subscription | 1 | 79 | 285 | 870 | 59 | 1482 | 87 | GitHub发现 |
| Lin-arm/gkd-Rules | 777 | 129 | 33 | 195 | 117 | 462 | 78 | GitHub发现 |
| AIsouler/gkd-subscription | 404 | 124 | 76 | 240 | 240 | 328 | 75 | GitHub发现 |
| yanmuq/muqi_gkd | 808 | 54 | 35 | 117 | 16 | 164 | 65 | GitHub发现 |
| oklazeno/gkd-subscription | 72 | 1 | 1036 | 3337 | 2663 | 5206 | 64 | GitHub发现 |
| mrlctate/gkd-mrlc | 2 | 75 | 693 | 1505 | 69 | 2446 | 62 | GitHub发现 |
| cjy0812/Ling033_GKD_Rules | 233 ⚠️ | 16 | 12 | 41 | 41 | 69 | 53 | GitHub发现 |
| LenorEric/GK-Lemon-D | 250 | 56 | 14 | 26 | 25 | 33 | 53 | GitHub发现 |
| timyang2005/gkd-merged-subscription | 999001 | 2 | 886 | 2074 | 2074 | 3213 | 51 | GitHub发现 |

> ⚠️ 表示上游订阅 ID 撞号（不影响本仓库产物：三档订阅 ID 990667/990668/990669 独立且唯一）。

## 三、本周变化

| 订阅 | 新增规则组 | 删除规则组 |
|---|---|---|
| 甘霖 | 0 | 0 |
| 奥怪 | 0 | 0 |
| Lin-arm | 0 | 0 |
| MengNianxiaoyao/gkd-subscription | 0 | 0 |
| Lin-arm/gkd-Rules | 0 | 0 |
| AIsouler/gkd-subscription | 0 | 0 |
| yanmuq/muqi_gkd | 0 | 0 |
| oklazeno/gkd-subscription | 0 | 0 |
| mrlctate/gkd-mrlc | 0 | 0 |
| cjy0812/Ling033_GKD_Rules | 0 | 0 |
| LenorEric/GK-Lemon-D | 0 | 0 |
| timyang2005/gkd-merged-subscription | 0 | 0 |

## 四、本周新增且不重复的规则

本周无新增的独有规则。

## 五、各源当前独有规则数

- 甘霖：528 条
- 奥怪：4 条
- Lin-arm：198 条
- MengNianxiaoyao/gkd-subscription：68 条
- Lin-arm/gkd-Rules：182 条
- AIsouler/gkd-subscription：153 条
- yanmuq/muqi_gkd：48 条
- oklazeno/gkd-subscription：102 条
- mrlctate/gkd-mrlc：237 条
- cjy0812/Ling033_GKD_Rules：38 条
- LenorEric/GK-Lemon-D：25 条
- timyang2005/gkd-merged-subscription：190 条

## 六、精准去重结果（推荐）

基于「快照图片 ID + 语义组名」识别跨源的同一广告（即使选择器写法不同也能识别），共合并 **8925** 条重复规则。

| 产物 | 应用数 | 规则组数 | 说明 |
|---|---|---|---|
| 全站合并全量 | 1094 | 5577 | 仅按内容指纹去重 |
| 全站去重精选 | 564 | 1773 | 只保留跨源唯一规则 |
| **全站精准去重** | 1094 | 3676 | 语义级去重，推荐导入 |

精准去重策略：同一广告只保留一份；小米系统应用优先奥怪版本，其余按「热度 + 活跃度 + 规则规模」评分选保留源；并合并各源独有选择器以防漏杀。

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
