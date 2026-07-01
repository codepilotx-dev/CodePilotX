# 审查侧栏与右侧 Dock 图标统一 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将审查侧栏 `.message-action` 图标、右侧 Dock 控件图标、以及 Dock tab 关闭图标三处的 SVG 渲染尺寸统一为 `var(--app-icon-size)` (16px) 和 `var(--app-icon-stroke-width)` (1.75)，消除视觉差异。

**架构:** 纯 CSS+JSX 修改。利用已存在的 `--app-icon-size` / `--app-icon-stroke-width` token，在 `controls.css` 和 `layout.css` 中添加/修复选择器，在 `ConversationPage.tsx` 中删除一个冗余的 `strokeWidth` prop。

**Tech Stack:** CSS Custom Properties, Lucide React, React TSX

## 全局约束

- 不动按钮容器尺寸（22×22 / 28×28 / 38×38 保持不变）。
- 不动 `iconTokens.ts` 中的常量值。
- 不动颜色、间距、布局、动效 token。
- 不动弹层定位、popover 对齐。

---

### Task 1: CSS — 统一 controls.css 中三组区域图标尺寸

**Files:**
- Modify: `apps/desktop/src/renderer/styles/controls.css:27-37`
- Verify: `apps/desktop/src/renderer/styles/controls.css:27-37`

**Interfaces:**
- Produces: 在已有 `.icon-button svg` 规则块后追加三条选择器，显式覆盖目标区域

- [ ] **Step 1: 确定现有规则位置**

```bash
grep -n "\.message-action svg" apps/desktop/src/renderer/styles/controls.css
```

Expected: line 30 附近，是 `.icon-button svg, .ghost-icon-button svg, .window-toolbar-icon svg, .message-action svg, .meta-chip svg, .chip-button svg { ... }` 块。

- [ ] **Step 2: 追加三条选择器到同一规则块**

编辑 `apps/desktop/src/renderer/styles/controls.css`，将现有规则块末尾：

```css
.icon-button svg,
.ghost-icon-button svg,
.window-toolbar-icon svg,
.message-action svg,
.meta-chip svg,
.chip-button svg {
  width: var(--app-icon-size);
  height: var(--app-icon-size);
  display: block;
  flex: 0 0 auto;
  stroke-width: var(--app-icon-stroke-width);
}
```

改为：

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

- [ ] **Step 3: 验证修改**

```bash
grep -n "review-sidebar-actions\|right-dock-add-button\|right-dock-control" apps/desktop/src/renderer/styles/controls.css
```

Expected: 三行选择器都存在。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/styles/controls.css
git commit -m "fix(desktop): 统一审查侧栏与右侧 Dock 控件图标 CSS 选择器"
```

---

### Task 2: CSS — 修复 layout.css 中右 Dock 关闭图标尺寸

**Files:**
- Modify: `apps/desktop/src/renderer/features/layout/layout.css:252-257`
- Verify: `apps/desktop/src/renderer/features/layout/layout.css:252-257`

**Interfaces:**
- Produces: `.right-dock-tab-close svg` 改用 `--app-icon-size` (16px) 而非 `--app-icon-size-sm` (14px)

- [ ] **Step 1: 找到当前规则**

```bash
grep -n "right-dock-tab-close svg" apps/desktop/src/renderer/features/layout/layout.css
```

Expected: 显示行号和当前内容。

- [ ] **Step 2: 将 `--app-icon-size-sm` 改为 `--app-icon-size`**

编辑 `apps/desktop/src/renderer/features/layout/layout.css`，将第 252-257 行：

```css
.right-dock-tab-close svg {
  width: var(--app-icon-size-sm);
  height: var(--app-icon-size-sm);
  display: block;
  stroke-width: var(--app-icon-stroke-width);
}
```

改为：

```css
.right-dock-tab-close svg {
  width: var(--app-icon-size);
  height: var(--app-icon-size);
  display: block;
  stroke-width: var(--app-icon-stroke-width);
}
```

- [ ] **Step 3: 验证修改**

```bash
grep -A4 "right-dock-tab-close svg" apps/desktop/src/renderer/features/layout/layout.css
```

Expected: `width: var(--app-icon-size); height: var(--app-icon-size);`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/features/layout/layout.css
git commit -m "fix(desktop): 统一右侧 Dock 关闭图标尺寸为 16px"
```

---

### Task 3: JSX — 清除 ConversationPage.tsx 中冗余 strokeWidth prop

**Files:**
- Modify: `apps/desktop/src/renderer/features/session/ConversationPage.tsx:2579`
- Verify: `apps/desktop/src/renderer/features/session/ConversationPage.tsx:2579`

**Interfaces:**
- Produces: `Columns2` 的 `strokeWidth={APP_ICON_STROKE_WIDTH}` 被删除

- [ ] **Step 1: 找到目标行**

```bash
grep -n "strokeWidth.*APP_ICON_STROKE_WIDTH" apps/desktop/src/renderer/features/session/ConversationPage.tsx
grep -n "Columns2" apps/desktop/src/renderer/features/session/ConversationPage.tsx
```

确认大约第 637 行（columns2 的定义处）和第 2579 行（review 侧栏的渲染处）有该 prop。

- [ ] **Step 2: 删除第 2579 行的 `strokeWidth={APP_ICON_STROKE_WIDTH}`**

将第 2579 行从：

```tsx
                <Columns2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
```

改为：

```tsx
                <Columns2 size={APP_ICON_SIZE} />
```

CSS `--app-icon-stroke-width: 1.75` 仍然会生效，无需担忧。

- [ ] **Step 3: 验证修改**

```bash
grep -n "Columns2" apps/desktop/src/renderer/features/session/ConversationPage.tsx
```

Expected: 第 637 行（react 组件定义处，不动）和第 2579 行（不再含 `strokeWidth` prop）。

- [ ] **Step 4: 验证 TypeScript 编译（如有构建命令）**

检查是否有 typecheck/lint：

```bash
cd /d/VueProject/ClaudeCode && grep -m1 "\"typecheck\"\|\"lint\"" package.json 2>/dev/null || echo "no typecheck script found"
```

如果有 typecheck 脚本则运行它。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/features/session/ConversationPage.tsx
git commit -m "fix(desktop): 删除审查侧栏 Columns2 冗余 strokeWidth prop"
```

---

### Task 4: 整体验证

- [ ] **Step 1: 检查是否有 TypeScript 编译/类型检查**

```bash
cd /d/VueProject/ClaudeCode && cat package.json | grep -A3 '"typecheck\|"check\|"build\|"lint' | head -10
```

如果有可用命令，运行之。如果没有，自行做类型审查：对改过的文件跑 `npx tsc --noEmit`。

- [ ] **Step 2: 视觉验证（手动）**

启动桌面应用，打开一个会话页，展开审查侧栏和右侧 Dock 多个 tab，截取包含 `.review-sidebar-actions`、`.right-dock-add-button`、`.right-dock-control`、`.right-dock-tab-icon`、`.right-dock-tab-close` 的截图区域。比对各个 SVG glyph 的像素尺寸，确认全部在 16px / stroke-width 1.75 一致。

- [ ] **Step 3: 回滚确认**

所有修改的 3 个文件可通过如下命令回滚：

```bash
git checkout apps/desktop/src/renderer/styles/controls.css
git checkout apps/desktop/src/renderer/features/layout/layout.css
git checkout apps/desktop/src/renderer/features/session/ConversationPage.tsx
```
