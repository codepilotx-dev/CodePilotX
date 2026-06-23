# 图一内联审批 UI 实现计划

## 目标

- 将桌面端审批状态 UI 做成截图中的样式：审批卡出现在对话流底部，而不是居中的权限弹窗。
- 卡片主标题为“是否应用这些更改?”，内容展示待审批对象摘要，底部展示编号选项和提交操作。
- 侧边栏继续展示会话级“等待批准”状态，不改变现有会话列表数据流。

## 实现步骤

1. 梳理 `ConversationPage` 当前如何渲染 `permission_request` 事件，以及 `DesktopLayout` 如何从 `pendingPermissions` 打开 `PermissionRequestModal`。
2. 在 `ConversationPage` 中新增内联审批卡组件：
   - 使用 `pendingPermissions[0]` 作为当前待审批请求。
   - 布局对齐截图：白色卡片、圆角、顶部标题、摘要行、三条选项、右下角“跳过 / 提交”。
   - 默认选中“是”，支持选择“是，本次会话不再询问”和“否，请告知 Codex 如何调整”。
3. 将审批动作接到现有 `decidePermission()`：
   - “是”提交 `allow`。
   - “是，本次会话不再询问”提交 `allow + alwaysAllow`。
   - “否”提交 `deny`。
   - “跳过”暂按 `deny` 处理，避免请求悬挂。
4. 移除或停用当前居中 `PermissionRequestModal` 的自动显示，避免和内联卡重复。
5. 样式写入现有桌面样式文件，保持桌面端即可，不做移动端适配。
6. 验证：
   - 运行相关 renderer/typecheck 测试。
   - 若有可用桌面开发环境，再启动桌面端检查 UI 外观。

## 后续可做

- 把文件变更类审批卡扩展为真实 diff 摘要，显示 `+ / -` 行数。
- 把普通工具权限审批卡扩展为更贴近工具类型的摘要，如 PowerShell 命令、文件路径、MCP 工具名。
- 后续再处理 PowerShell `ask` 没有进入审批 UI 的运行链路问题。
