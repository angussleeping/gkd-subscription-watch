# GKD 三库订阅检测

每周自动抓取并对比 **Lin-arm (ID 667)**、**甘霖 (ID 233)**、**奥怪 (ID 86)** 三个 GKD 订阅规则，找出新增、删除和跨库重复的规则，生成去重订阅并推送给你。

## 工作原理

1. **抓取**：从三个订阅源拉取最新规则（含备用源自动降级）
2. **指纹比对**：对每条规则组提取内容指纹（基于 `activityIds` + `matches`，忽略名称/顺序/快照 URL 等非逻辑字段），因此即使规则名称不同，只要匹配逻辑一致就能识别为重复
3. **差异检测**：与上周基线快照对比，找出新增和删除的规则组
4. **去重产物**：
   - `dist/unique_rules.json5`：**三库去重精选**，只保留跨库唯一的规则（其他两库都没有的），避免重复触发和误触
   - `dist/merged.json5`：**三库合并全量**，全部规则按指纹去重后合并，重复规则只留一份（优先级 Lin-arm > 甘霖 > 奥怪）
5. **推送**：每周一自动生成报告、提交到仓库，并在有变化时发布 Release 通知你

## 导入订阅

在 GKD App 的订阅页点右下角 **+**，粘贴以下任一链接：

```
https://raw.githubusercontent.com/angussleeping/gkd-subscription-watch/main/dist/unique_rules.json5
```

```
https://raw.githubusercontent.com/angussleeping/gkd-subscription-watch/main/dist/merged.json5
```

> 国内若 raw.githubusercontent.com 访问慢，可把域名替换为 `raw.gitmirror.com` 或使用 jsDelivr：
> `https://cdn.jsdelivr.net/gh/angussleeping/gkd-subscription-watch@main/dist/unique_rules.json5`

## 目录结构

- `scripts/main.mjs`：主流程（抓取、对比、生成产物）
- `scripts/lib.mjs`：指纹与解析工具
- `scripts/config.mjs`：订阅源与输出配置
- `data/baseline.json`：规则指纹基线（每周自动更新，用于计算差异）
- `data/changed.json`：本周变化摘要
- `reports/`：每周检测报告（`latest.md` 为最新一期）
- `dist/`：生成的去重合订订阅文件

## 手动运行

在 GitHub 仓库页面进入 **Actions** → 选择「每周检测 GKD 订阅差异」→ **Run workflow**，可立即触发一次检测。

本地运行：

```bash
npm install
npm start
```

## 调整检测频率

编辑 `.github/workflows/weekly.yml` 中的 cron 表达式。默认每周一 09:00（北京时间）：

```yaml
schedule:
  - cron: '0 1 * * 1'   # UTC 01:00 = 北京时间 09:00
```

## 通知方式

- Release：仓库有变化时自动发布 Release，你在 GitHub 关注仓库后即可收到通知
- 如需邮件/微信推送，可在 workflow 中增加通知步骤，并通过 Repository Secrets 配置凭据
