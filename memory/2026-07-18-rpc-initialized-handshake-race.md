# RPC initialized 握手竞态排查

## 状态

DONE

## 现象

CodePilotX 首次启动后，Review、模型目录等普通 RPC 偶发返回：

```text
RPC 连接尚未完成 initialized 握手
```

Renderer 随后可能把该错误包装成 `AgentRpcError: Internal RPC error`。

## 根因

Renderer 只有部分入口通过 Agent 可用性探测触发
`initialize -> initialized`。模型、集成、子智能体等业务方法可以直接调用
`rpc.call`，因此首次启动时多个业务请求会与握手并发，并在 Agent 接受
`initialized` 之前到达。

服务端 JSON-RPC 路由和 `X-CodePilotX-Connection-Id` 传递本身可用。使用独立
Agent 端口依次发送 `initialize`、`initialized`、`project/list` 均成功，排除了
Router 方法注册和 HTTP header 丢失。

另一个放大问题是通知请求此前忽略 HTTP 200 响应体。如果 Agent 对
`initialized` 返回 JSON-RPC error，Renderer 仍可能把它记为握手成功。

## 修复

- 在 `agentRpcClient` 增加共享 `ensureInitialized()`。
- 配置握手的客户端在执行任何非 `initialize` RPC 前统一等待该 Promise。
- 并发业务请求复用同一次握手。
- Agent 重启后继续按连接代次重新握手。
- `initialized` 的 HTTP 204 视为成功；HTTP 200 时解析 JSON-RPC error 并抛出。
- `desktopClient` 将完整 renderer 握手参数交给 RPC 客户端，不再由可用性探测单独维护握手流程。

## 证据

- 修复前 Agent 日志显示普通 `/rpc` 请求先于成功的 `initialized` 204 到达。
- 修复后首次加载日志顺序为 initialize、initialized 204、业务请求。
- 在实际运行的 CodePilotX 中打开“审阅”Tab，显示真实空状态，不再出现握手错误。

## 回归保护

- 并发业务请求只执行一次首次握手，并在 `initialized` 完成后才发送。
- `initialized` 通知收到 JSON-RPC error 时不得误判为成功。
- 既有正式 header/连接标识和 Agent 重启恢复用例继续通过。

## 验证

- Renderer RPC 客户端测试：4 passed。
- Renderer 全量测试：122 passed。
- Renderer typecheck：通过。
- Renderer production build：通过。
- `git diff --check`：通过。
