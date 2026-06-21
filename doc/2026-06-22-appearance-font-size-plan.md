# 外观页字号真实可调

## Summary
- 将外观页的 `UI 字号` 和 `代码字号` 做成全局持久化设置，默认分别为 `14px` 和 `12px`。
- 用户调整后立即写入主题设置文件，并通过 `:root` CSS 变量实时影响桌面端 UI 和代码区域。
- 实施前先把本计划保存到 `D:\VueProject\ClaudeCode\doc\2026-06-22-appearance-font-size-plan.md`，再修改代码。

## Key Changes
- 在 `DesktopThemeSettings` 增加全局字段：
  - `fontSizes: { ui: number; code: number }`
  - 默认值：`ui: 14`，`code: 12`
  - 归一化范围：`ui` 限制 `11-20`，`code` 限制 `10-20`，非法或缺失时回退默认值。
- 在主题应用逻辑里注入字号变量：
  - `--fs-ui`
  - `--fs-code`
  - `--fs-11` 到 `--fs-16` 根据 `ui` 基准等差派生，例如 `--fs-14 = ui px`、`--fs-13 = ui - 1 px`
  - `--fs-26` 按 `ui + 12 px` 派生，保留大标题相对比例。
- 外观页控件改为读取和保存 `settings.fontSizes`：
  - 移除 `uiFontSize` / `codeFontSize` 的本地 `useState`
  - `NumberInput` 增加 `min`、`max`、`step`，并处理空值/非数字输入，保存前统一 clamp。
- CSS 调整：
  - 保留现有 `--fs-*` 变量体系，让大部分 UI 跟随 `UI 字号`。
  - 将聊天 markdown、代码块、inline code、diff 预览、命令输出等代码文本改用 `--fs-code`。
  - 将外观页自身仍写死的关键 `14px/16px/22px` 改为对应 `--fs-*`，确保调字号时设置页也能真实变化。

## Test Plan
- 运行 `bun run desktop:typecheck`。
- 手动验证：
  - 打开外观页，调整 `UI 字号` 后，设置页、侧边栏、聊天正文等普通 UI 文本立即变化。
  - 调整 `代码字号` 后，markdown 代码块、inline code、diff 视图、命令输出立即变化。
  - 切换浅色/深色/系统主题后字号保持不变。
  - 重启桌面端后字号保持上次设置。
  - 旧的 `theme.json` 没有 `fontSizes` 时能正常加载并使用默认字号。

## Assumptions
- 字号是全局外观设置，不跟随单个主题，也不进入主题导入/导出。
- 现有主题导入导出只继续处理颜色、字体族、对比度等主题内容。
- 不处理非桌面视口适配，符合项目说明。
- 不触碰当前未跟踪的 `log.txt`。
