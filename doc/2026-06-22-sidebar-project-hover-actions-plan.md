# sidebar 项目行 hover actions 调整计划

## 目标

把项目行的 `ChevronDown` 图标移入 `.sidebar-project-actions` 区域。默认状态下右侧只显示展开/折叠 chevron；鼠标悬停或键盘 focus 在 `.sidebar-project-header` 上时隐藏 chevron，显示项目操作按钮。

## 当前结构

- `SidebarProjectGroup.tsx` 现在把 `.sidebar-project-chevron` 直接放在 `.sidebar-project-name` 后面。
- `.sidebar-project-actions` 只包含更多菜单和新建对话按钮，并通过 `is-visible` 控制显隐。
- `sidebar.css` 现在会在 hover/focus 时改变 chevron 颜色，而不是隐藏 chevron。

## 实施步骤

1. 增加 `SidebarProjectGroup` 源级回归测试，断言 `.sidebar-project-chevron` 出现在 `.sidebar-project-actions` 内部。
2. 增强 `sidebar.css` 测试，断言项目 actions 默认显示 chevron、隐藏 action buttons，hover/focus/menu 打开时隐藏 chevron、显示 action buttons。
3. 修改 `SidebarProjectGroup.tsx`：
   - 将 `ChevronDown` 移入 `.sidebar-project-actions`。
   - 给更多菜单和新建按钮包一层 `.sidebar-project-action-items`。
   - actions 容器在项目存在会话时始终渲染 chevron；按钮仍只在 hover/focus/menu 打开时可交互。
4. 修改 `sidebar.css`：
   - 让 `.sidebar-project-actions` 默认可见，用作右侧固定槽。
   - 默认显示 `.sidebar-project-chevron`。
   - 默认隐藏 `.sidebar-project-action-items`。
   - `.sidebar-project-header:hover`、`:focus-within`、`.sidebar-project-actions.is-visible` 时隐藏 chevron 并显示 action items。
5. 运行验证：
   - `bun test apps/desktop/src/renderer/components/sidebar/SidebarProjectGroup.test.ts apps/desktop/src/renderer/styles/sidebar.test.ts`
   - `bun run desktop:typecheck`
   - `git diff --check`
6. 复查 diff，确认不改无关布局和之前未提交的其它改动。

## 不做的事

- 不改变项目展开/折叠点击行为。
- 不改变更多菜单或新建对话按钮的功能。
- 不改 session 行 hover actions。
