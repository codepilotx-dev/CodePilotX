# 首页移除调试工具栏、改用普通 ChatComposer 计划

## 目标

- 把 `QuickChatView` 里的 `home-debug-toolbar` 和 `home-debug-panel` 全部去掉。
- 首页只保留普通的 `chat-composer`，与 `ConversationPage` 底部使用的样式一致。
- 删除仅用于演示/调试的 mock 数据和死代码，避免后续维护误用。

## 当前问题

- `apps/desktop/src/renderer/components/QuickChatView.tsx:103` 用 `home-debug-panel` 包住三个分支视图：
  - `chat`：真实的 `composer`。
  - `permission`：用 `MOCK_PERMISSION_REQUEST` 演示 `InlineApprovalCard`。
  - `plan`：用 `MOCK_EXIT_PLAN_REQUEST` 演示 `ExitPlanModeApproval`。
- `apps/desktop/src/renderer/components/QuickChatView.tsx:142` 用 `home-debug-toolbar` 提供一个固定在底部的三个按钮切换栏。
- 这套 UI 仅供本地调试，附带 `MessageSquare` / `HelpCircle` / `CheckSquare`、`DEBUG_VIEWS`、`DebugViewKey`、`mockPermissionMode` 等状态与常量，对外发布版本不应保留。
- `apps/desktop/src/renderer/styles/composer.css:612-670` 里有 `home-debug-toolbar`、`home-debug-tool*`、`home-debug-panel` 的样式规则，TSX 改完后变成死代码。

## 实现步骤

1. 修改 `apps/desktop/src/renderer/components/QuickChatView.tsx`：
   - 删掉 `DebugViewKey` 类型、`DEBUG_VIEWS` 常量。
   - 删掉 `MOCK_PERMISSION_REQUEST`、`MOCK_EXIT_PLAN_REQUEST` 两个 mock 权限请求。
   - 删掉 `useState` 出来的 `debugView`、`mockPermissionMode` 及其 setter。
   - 删掉不再使用的导入：`MessageSquare`、`HelpCircle`、`CheckSquare`、`LucideIcon`（`lucide-react`）、`InlineApprovalCard`、`ExitPlanModeApproval`、`DesktopPermissionMode`、`DesktopPermissionRequest`。
   - 把 103-165 行（`home-debug-panel` 整块 + `home-debug-toolbar` 整块）替换成正常 composer 渲染：
     ```tsx
     {composer ? (
       <div className="chat-composer">{composer}</div>
     ) : null}
     ```
   - 保留 `useQuickChatContext()` 拿到的 `composer`、`workspaceName` 等字段，以及 `ProjectSwitcherPopover` 相关逻辑。
2. 修改 `apps/desktop/src/renderer/styles/composer.css`：
   - 删掉 612-670 行：`home-debug-toolbar`、`home-debug-tool`（含 `:hover`、`.active`、`.active:hover`）、`home-debug-tool-icon`、`home-debug-tool-label`、`home-debug-panel`。
3. 复用既有样式：
   - `apps/desktop/src/renderer/styles/main.css:31-42` 已经定义了 `.quick-chat-view .chat-composer` 的居中、阴影样式，不用新加 CSS。

## 不动的东西

- `useQuickChatContext()` 的 `composer` 字段保持原状。
- `apps/desktop/src/renderer/components/RightDock.tsx:411` 的 `.right-dock-side-chat-composer`、`apps/desktop/src/renderer/components/ConversationPage.tsx:645` 的 `.chat-composer` 与本次改动无关，不动。
- `apps/desktop/src/renderer/context/QuickChatContext.ts` 的类型与提供者不动。

## 验证

- 按 `AGENTS.md` 约定，本 checkout 没有可跑的构建/测试脚本，所以做定向审查：
  - `grep` 全仓 `home-debug-toolbar` / `home-debug-panel` / `home-debug-tool` / `MOCK_PERMISSION_REQUEST` / `MOCK_EXIT_PLAN_REQUEST` / `DEBUG_VIEWS` / `DebugViewKey`，确认 0 命中。
  - 检查 `QuickChatView.tsx` 的导入列表没有遗留未使用的符号。
  - 确认 `composer.css` 删除后没有破坏其它样式规则（仅删除这八条独立选择器）。
- 后续若恢复桌面端开发环境，手动打开首页确认 composer 居中显示、无底部调试栏。

## 后续可做

- 如果以后需要重新引入权限 / 计划视图的演示，把 mock 数据放到独立的 `stories/` 或 `dev/` 入口，不要再写进生产页面 `QuickChatView`。
- 把 `chat-composer` 在首页的容器样式进一步抽成 design token，跟 `ConversationPage` 的 footer 对齐。
