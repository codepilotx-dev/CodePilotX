# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/renderer/src/`，并补充 renderer workspace 规则。

## UI 与模块约定

- 遵循 `routes.tsx`、`App.tsx` 和 workbench registry 的现有页面编排与 lazy import 边界。
- Session 代码按 `conversation/`、`composer/`、`timeline/`、`approvals/`、`workflow/`、`summary/`、`subagents/`、`state/` 维护。
- Review 代码按 `workspace/`、`diff/`、`comments/`、`source/`、`state/` 维护。
- Layout 代码按 `shell/`、`dock/`、`tabs/`、`panels/` 维护。
- Review diff 解析、inline/split 展示、虚拟列表和评论逻辑只能有一个实现来源。
- 新代码不得继续扩大 2000 行以上聚合组件；修改现有超大组件时，优先抽出本次涉及的独立职责。
- 复用 `components/ui/`、design-system token 和已有 feature 组件，不创建局部视觉体系。

## 状态与副作用

- React component 保持声明式；网络、IPC、持久化和 subscription 副作用放入 service、hook 或既有 feature state 层。
- UI component 不得直接解释新的 server wire 格式；事件先经过 Agent adapter、session-view projection 或既有 reducer。
- 设置变化必须经过现有 settings hook、storage helper 和 desktop client。
- 禁止重新加入旧 UI state、legacy plan、v3 Review expansion 或旧 AskUserQuestion shape。

## 体验与样式

- 使用 `styles/design-system/tokens.scss` 及现有 feature/component SCSS 层。
- UI 修改时按相关性验证桌面窗口尺寸、键盘焦点、主题、reduced-motion、popover 定位和会话恢复。
- 设置修改时验证本地更新及经 service boundary 的持久化往返。
- 保持 Review、Conversation 和 workbench 面板的 lazy chunk 可解析。
