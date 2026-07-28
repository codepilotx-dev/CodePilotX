# Agent SSE 历史重放断连排障报告

- 症状：桌面端能够短暂连接 Agent，约 6 秒后 watchdog 超时并重新加载，随后持续断线重连。
- 根因：`/rpc/events` 在请求未携带 `after` 或 `Last-Event-ID` 时错误地从事件 0 开始重放。当前数据库包含大量约 3.47 MB 的 `catalog/updated` 历史事件，首次订阅会重复发送约 1 GB 数据，使 Bun Agent 工作集升至 8–12 GB，并阻塞健康探测。
- 修复：首次无 cursor 的 SSE 订阅从当前最大事件 ID 开始，仅接收后续事件；显式 `after` 和 `Last-Event-ID` 继续保留断线重放语义。
- 回归测试：`apps/agent/test/event-cursor.test.ts` 覆盖首次订阅、显式 query cursor、`Last-Event-ID` 和 `after=0`。
- 验证：修复后 Agent 工作集稳定在约 235 MB；连续 30 秒 watchdog RPC 均在 0–1 ms 返回，无新增 `connection-lost`；Agent 类型检查和 2 项 cursor 测试通过。
- 数据边界：未删除或压缩用户现有的约 1 GB SQLite 数据库。
- 状态：DONE
