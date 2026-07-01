# 统一审查侧栏与右侧 Dock 图标样式 — 设计文档

日期：2026-07-02
状态：设计中

## 背景

用户反馈：`ConversationPage.tsx` 中 "审查代码" 工具栏里的 `.message-action` 图标，以及 `RightDock.tsx` 头部 `+ / - / PanelRight` 控件的图标，两组视觉尺寸不一致。同时 `.right-dock-tab-close` 的关闭图标与这两组也不一致。

希望这两/三组图标大小、样式完全一致。

## 当前事实（代码现状）

- `apps/desktop/src/renderer/components/ui/iconTokens.ts` 暴露 `APP_ICON_SIZE = 14`、`APP_ICON_STROKE_WIDTH = 2`。这是 JSX 传给 Lucide 图标的 `size` / `strokeWidth` prop。
- `apps/desktop/src/renderer/styles/base.css` 定义 `--app-icon-size: 16px`、`--app-icon-size-sm: 14px`、`--app-icon-stroke-width: 1.75`。
- `apps/desktop/src/renderer/styles/controls.css` 第 27-37 行：
  ```css
  .icon-button svg, .ghost-icon-button svg, .window-toolbar-icon svg,
  .message-action svg, .meta-chip svg, .chip-button svg {
    width: var(--app-icon-size);   /* 16px */
    height: var(--app-icon-size);
    stroke-width: var(--app-icon-stroke-width);  /* 1.75 */
  }
  ```
  这一组规则已经覆盖了 `Plus / Minus / PanelRight / .message-action` 的图标 → **CSS 把渲染尺寸强制为 16px、stroke 强制为 1.75**，忽略 JSX 上的 `size` / `strokeWidth` prop。
- `apps/desktop/src/renderer/features/layout/layout.css`：
  - `.right-dock-tab-icon` → `var(--app-icon-size)` = 16px ✓
  - `.right-dock-tab-close svg` → `var(--app-icon-size-sm)` = **14px** ✗（唯一一个 14px）

也就是说：

| 区域 | 容器 | 图标 CSS 尺寸 | stroke 宽度 |
|------|------|--------------|------------|
| 审查侧栏 `.message-action` | 22×22 | 16px | 1.75 |
| 右侧 Dock `.right-dock-add-button` | 38×38 | 16px | 1.75 |
| 右侧 Dock `.right-dock-control` | 38×38 | 16px | 1.75 |
| 右侧 Dock `.right-dock-tab-icon` | (随 tab) | 16px | 1.75 |
| 右侧 Dock `.right-dock-tab-close` | 28×28 | **14px** | 1.75 |

→ `.right-dock-tab-close` 是唯一的偏差源。除此之外，"图标 glyph" 在所有目标区域里其实已经是 16/1.75 一致。

**唯一差异来源**：`.right-dock-tab-close` 的 CSS 显式覆盖到了 `--app-icon-size-sm` = 14px。

**JSX 层冗余**：审查侧栏里的 `.message-action` 图标（Sparkles / Search / RotateCcw / FolderOpen / Filter / Sliders / Columns2 / PanelRight）部分用了 `strokeWidth={APP_ICON_STROKE_WIDTH}` (=2)。该值被 CSS (`--app-icon-stroke-width: 1.75`) 覆盖，造成源代码 / 实际渲染不一致的认知割裂。

## 目标

将所有 `.review-sidebar-actions .message-action`、`.right-dock-add-button`、`.right-dock-control`、`.right-dock-tab-icon`、`.right-dock-tab-close` 内部的 SVG 图标统一为 `var(--app-icon-size)` (16px) 与 `var(--app-icon-stroke-width)` (1.75)。容器大小、布局、弹层定位、行为不变。

## 不在范围内

- 按钮容器尺寸（22×22 / 28×28 / 38×38）保持不变。
- 主题、颜色 token、布局、间距、动效均不动。
- 不动 `iconTokens.ts` 中的常量值。
- 不新增/删除任何图标。

## 实施变更

### 1. CSS：`apps/desktop/src/renderer/styles/controls.css`

将共享选择器扩展，显式锁定三组图标到统一 token：

```css
.icon-button svg,
.ghost-icon-button svg,
.window-toolbar-icon svg,
.message-action svg,
.meta-chip svg,
.chip-button svg,
.review-sidebar-actions .message-action svg,
.right-dock-add-button > svg,
.right-dock-control > svg {
  width: var(--app-icon-size);
  height: var(--app-icon-size);
  display: block;
  flex: 0 0 auto;
  stroke-width: var(--app-icon-stroke-width);
}
```

> 说明：前 6 个选择器已存在；新增 3 行显式覆盖防止在嵌套场景里选择器特异度回落。

### 2. CSS：`apps/desktop/src/renderer/features/layout/layout.css`

将 `.right-dock-tab-close svg` 从 `--app-icon-size-sm` 改为 `--app-icon-size`，与其它三个区域对齐：

```css
.right-dock-tab-close svg {
  width: var(--app-icon-size);     /* was: --app-icon-size-sm */
  height: var(--app-icon-size);    /* was: --app-icon-size-sm */
  display: block;
  stroke-width: var(--app-icon-stroke-width);
}
```

视觉上之前靠 `opacity: 0` 默认隐藏 + 16px 容器区分层级；改成 16px 不会突然变重。

### 3. JSX：`apps/desktop/src/renderer/features/session/ConversationPage.tsx`

在 `.review-sidebar-actions` 的 8 个 `.message-action` 图标上去掉 `strokeWidth={APP_ICON_STROKE_WIDTH}`，因为 CSS 已经强制成 1.75，prop 传 `2` 反而误导阅读。

涉及图标：`Sparkles`、`Search`、`RotateCcw`、`FolderOpen`、`Filter`、`Sliders`、`Columns2`、`PanelRight`。其中部分已经没传 strokeWidth，但部分仍传，统一清除以保持源代码和实际渲染一致。

### 4. 不动 `iconTokens.ts`

`APP_ICON_SIZE = 14` 与 `APP_ICON_STROKE_WIDTH = 2` 仍可作为"未由 CSS 控制"的小工具/弹层兜底。本次修复不动其数值。

## 验证步骤

1. **代码 review**：
   - `controls.css` 新增的选择器覆盖了 `.review-sidebar-actions .message-action`、`.right-dock-add-button`、`.right-dock-control` 三个区域。
   - `layout.css` 中 `.right-dock-tab-close svg` 尺寸已改为 `var(--app-icon-size)`。
   - `ConversationPage.tsx` 的 8 个图标不再传 `strokeWidth={APP_ICON_STROKE_WIDTH}`。

2. **Token 一致性**：
   - `--app-icon-size` = 16px、`--app-icon-stroke-width` = 1.75 在 `base.css` 不变。

3. **视觉对照**（这一项需在 desktop 实际启动后用截图核对，不能纯静态推断）：
   - 打开会话页 + 审查侧栏，挂上 dock 多个 tab。
   - 截取与用户截图同区域的片段，比较 Sparkles/RotateCcw（审查侧栏）、Plus/Minus/PanelRight（dock 控件）、tab-close（dock 标签）三处 glyph 视觉高度，期望一致。
   - 容器依旧为 22×22 / 38×38 / 28×28。

4. **回归**（目标范围内不应发生变化）：
   - tab-close 默认 `opacity: 0`、hover/active/focus 显示：保持。
   - 弹层（popover、筛选菜单、视图切换）位置与对齐：保持。
   - 暗/亮主题：保持。

## 风险与回滚

- 关闭图标从 14 → 16px：这是唯一一个会让"按像素的间距"变化的视觉改动。其余只删多余的 prop，对视觉无影响。若想保留原观感，把 `--app-icon-size-sm` 改回即可。
- 添加 CSS 选择器后若有更高特异度的规则冲突（例如后续手动加 `!important`），新规则会失去控制 — 可在 review 时通过 DevTools 检查 `computed style`。
- 回滚：删除三个 CSS 修改 + 还原 JSX 的 `strokeWidth={APP_ICON_STROKE_WIDTH}`，提交 `git revert`。

## 文件清单

- `apps/desktop/src/renderer/styles/controls.css`（新增 3 行选择器）
- `apps/desktop/src/renderer/features/layout/layout.css`（`.right-dock-tab-close svg` 尺寸改写）
- `apps/desktop/src/renderer/features/session/ConversationPage.tsx`（删除 8 处冗余 `strokeWidth` prop）

## 不在本次改动

- `apps/desktop/src/renderer/components/ui/iconTokens.ts`
- 任何 `.tsx` 中按钮 `className`、布局、容器 CSS、颜色、间距
