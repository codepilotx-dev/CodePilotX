# MiniMax API Key 地区错误调试报告

- 症状：`minimax-coding-plan/MiniMax-M3` 已显示凭据连接，但对话返回 `invalid api key`。
- 根因：保存的密钥属于中国站 `api.minimaxi.com`，当前 Provider 却是国际站 `api.minimax.io`。
- 证据：同一加密凭据访问国际站 `/anthropic/v1/models` 返回 401，访问中国站返回 200，且中国站目录包含 `MiniMax-M3`。
- 修复：`IntegrationService.connect()` 保存 MiniMax Token Plan 密钥前验证地区；若另一区域鉴权成功，返回 `INTEGRATION_REGION_MISMATCH` 并提示正确 Provider，不再把错误地区的密钥标记为已配置。
- 回归测试：`apps/agent/test/integration-service.test.ts`。
- 目录问题：Models.dev `api.json` 当前返回 166 个 Provider；设置页只取前 80 个，导致第 97 位的 `minimax-cn`、第 156 位的 `minimax-cn-coding-plan` 和第 159 位的 `minimax` 被隐藏。已移除截断并标记 Models.dev 来源与 logo。
- 删除问题：Desktop 原先只按缓存查找 credential，删除后不重新读取 Integration，UI 还会手工把状态改为未配置。现改为删除前强制刷新、删除后重新读取并验证 credential 已消失；Agent 对 SQL 未删除任何行返回 `CREDENTIAL_DELETE_FAILED`。
- 状态规则：环境变量连接仍会显示为已配置，但删除按钮禁用并明确说明不能在应用内删除，不再伪报“API 密钥已删除”。
- Desktop 回归测试：`apps/desktop/renderer/test/desktop-client-provider.test.ts`。
- 状态：DONE。
