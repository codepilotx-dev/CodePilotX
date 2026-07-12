# Desktop Rust 权限配置误传为 sandbox

- 症状：Rust app-server 在 `thread/start` 时拒绝 `:workspace`，提示 `sandbox` 只接受 `read-only`、`workspace-write`、`danger-full-access`。
- 根因：`rustSidecarRuntime.ts` 把桌面端的命名权限配置 `permissionProfile` 误放入协议的 `sandbox` 字段。
- 修复：线程启动和恢复统一发送 `permissions: permissionProfile`，不再把命名配置作为 `sandbox` 发送；桌面协议适配类型补充 `permissions`。
- 回归覆盖：`rustSidecarRuntime.test.ts` 验证启动和恢复参数包含 `permissions: ':workspace'` 且不包含 `sandbox`。
- 验证：`bun test apps/desktop/src/main/rustSidecarRuntime.test.ts apps/desktop/src/main/rustAppServerClient.test.ts`（61 通过）；`bun run desktop:typecheck`（通过）。
- 状态：DONE。
