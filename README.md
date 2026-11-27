# GKD 全站订阅动态检测

每周自动扫描 **GitHub 全站的 GKD 订阅仓库**，发现活跃、有价值的新订阅并纳入合并；仓库归档或长期停更的源自动降级。生成精准去重订阅与差异报告，经 GKD 官方规则校验后发布 Release 通知你。

## 工作原理

1. **全站发现**：每周用多组关键词搜索 GitHub（订阅/规则/开屏广告等），并读取社区维护的订阅收录名单作为种子，覆盖仓库名不含 `gkd` 的订阅
2. **质量筛选**：自动排除归档仓库、stars 不足 10、超过 180 天无更新、非订阅类仓库（App 本体/工具/教程/AI 论文等）；候选源必须能解析出有效订阅文件且至少 5 个规则组
3. **自动降级**：已纳入的源一旦归档、长期停更或连续抓取失败，自动移出活跃池并在报告中说明原因；重新活跃后可再次纳入
4. **动态评分**：按 stars（热度）、最近推送时间（活跃度）、规则组数量（规模）综合评分，决定合并时保留谁的规则写法
5. **指纹比对**：对每条规则组提取内容指纹（基于组级配置与规则匹配/执行字段，忽略名称/顺序/快照 URL 等元数据），与上周基线对比找出新增/删除
6. **去重产物**（三档，推荐第一档）：
   - `dist/precise.json5`：**精准去重订阅（推荐）**。先按「快照图片 ID + 语义组名」识别跨源的同一广告——即使各库选择器写法完全不同也能识别为重复；再按「同应用同名」做二次合并，把同一广告在不同源的规则集（补丁选择器、不同 key 编号、繁体/英文变体）合并为一组。合并时并集适用范围与规则集，规则 key 冲突自动重编号并修正 `preKeys` 引用；仅当 `matchRoot` 等选择器解析语义不同时保留为独立组。小米系统应用优先保留奥怪版本，其余按动态评分选保留源
   - `dist/unique_rules.json5`：**全站去重精选**，只保留跨源唯一的规则（其他源都没有的），同样执行同名组二次合并
   - `dist/merged.json5`：**全站合并全量**，全部规则按内容指纹去重后合并，同样执行同名组二次合并
   - 微信朋友圈、公众号（订阅号）文章广告类规则在上游多被默认关闭，合并产物中会统一启用（选择器已取各源并集），避免出现“导入了但不生效”的情况
7. **推送**：每周一自动生成报告、提交到仓库，并在有变化时发布 Release 通知你；去重算法重大升级时通过 `OUTPUT_VERSION` 强制发布新版本

核心保底源：Lin-arm (667)、甘霖 (233)、奥怪 (86)、CKylinMC 补充规则 (5506)——它们只在仓库归档或连续失败时才会降级，不因 stars/停更阈值被剔除。

## 导入订阅

在 GKD App 的订阅页点右下角 **+**，粘贴以下链接（推荐精准去重版）：

```
https://raw.githubusercontent.com/angussleeping/gkd-subscription-watch/main/dist/precise.json5
```

其他档位：

```
https://raw.githubusercontent.com/angussleeping/gkd-subscription-watch/main/dist/unique_rules.json5
https://raw.githubusercontent.com/angussleeping/gkd-subscription-watch/main/dist/merged.json5
```

> 国内若 raw.githubusercontent.com 访问慢，可把域名替换为 `raw.gitmirror.com` 或使用 jsDelivr：
> `https://cdn.jsdelivr.net/gh/angussleeping/gkd-subscription-watch@main/dist/precise.json5`

> 三档订阅 ID 保持为 990669 / 990667 / 990668 不变，你之前导入的订阅会继续收到更新；通常只导入精准版一份即可。

## 目录结构

- `scripts/discover.mjs`：GitHub 全站发现、质量筛选、路径探测、自动降级
- `scripts/main.mjs`：主流程（抓取、对比、生成产物与报告）
- `scripts/precise.mjs`：精准去重（快照 ID + 语义名，动态评分选保留源）
- `scripts/lib.mjs`：指纹与解析工具
- `scripts/config.mjs`：发现参数与输出配置
- `data/sources.json`：动态源注册表（活跃源、降级源、发现统计）
- `data/baseline.json`：规则指纹基线（每周自动更新，用于计算差异）
- `data/changed.json`：本周变化摘要（含新增/降级源）
- `reports/`：每周检测报告（`latest.md` 为最新一期）
- `dist/`：生成的去重订阅文件

## 手动运行

在 GitHub 仓库页面进入 **Actions** → 选择「每周检测 GKD 全站订阅差异」→ **Run workflow**，可立即触发一次检测。

本地运行（需要 `gh` 已登录或设置 `GITHUB_TOKEN` 环境变量，用于 GitHub API 搜索）：

```bash
npm ci
npm test
npm start
npm run check
```

## 调整发现策略

编辑 `scripts/config.mjs` 的 `DISCOVERY`：

- `minStars`：新源最低 stars（默认 10）
- `maxInactiveDays`：超过多少天无推送视为停更（默认 180）
- `minGroups`：订阅最少规则组数（默认 5）
- `maxSources`：每周参与合并的源数量上限（默认 20）
- `queries`：GitHub 搜索关键词
- `communityList`：社区订阅收录名单地址

## 调整检测频率

编辑 `.github/workflows/weekly.yml` 中的 cron 表达式。默认每周一 09:00（北京时间）：

```yaml
schedule:
  - cron: '0 1 * * 1'   # UTC 01:00 = 北京时间 09:00
```

## 通知方式

- Release：仓库有变化（含新源纳入/降级）时自动发布 Release，你在 GitHub 关注仓库后即可收到通知
- 如需邮件/微信推送，可在 workflow 中增加通知步骤，并通过 Repository Secrets 配置凭据
