# Multi-Agent Mailbox 语义

## 概述

v4 引入的 mailbox 模式定义了子代理（subagent）与父线程之间的通信契约。
子代理是 first-class child thread/session，拥有独立的运行时和事件流。
父代理只接收 bounded completion message，不接收完整 transcript。

## 数据模型

### SubagentMetadata

定义在 `packages/core/src/agent/subagent.ts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `parentThreadId` | `ThreadId` | 父线程 ID |
| `forkedFromId` | `ThreadId` | Fork 源线程 ID |
| `agentPath` | `string` | 子代理路径（如 "agent/coder-v2"） |
| `agentRole` | `AgentRole` | 子代理角色 |
| `agentNickname` | `string?` | 自定义名字 |
| `model` | `string?` | 使用的模型 |
| `systemPromptOverride` | `string?` | 系统提示词覆盖 |

参考：codex-main v2 `Thread.forked_from_id`, `parent_thread_id`, `agent_role`, `agent_nickname`

### SubagentCompletionMessage

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `'completed' | 'failed' | 'interrupted'` | 完成状态 |
| `agentId` | `ThreadId` | 子代理 ID |
| `summary` | `string` | 摘要文本（bounded，非完整 transcript） |
| `output` | `Record?` | 关键输出 |
| `error` | `string?` | 错误信息 |
| `usage` | `{inputTokens, outputTokens, totalTokens}?` | Token 统计 |

## Fork 历史白名单

Fork 时只继承以下内容：

**事件类型白名单：**
- `thread.started`
- `turn.started`
- `turn.completed`

**Turn item type 白名单（item.completed 时）：**
- `user`
- `agent_message`
- `proposed_plan`
- `text`

**不继承的内容：**
- Tool call / tool result
- Reasoning
- File changes
- Permission requests
- Guardian reviews
- 临时协作提示

参考：codex-main v2 `thread/fork.excludeTurns`

## SessionCoordinator

定义在 `packages/core/src/agent/coordinator.ts`

协调器管理 thread 的执行顺序：

| 语义 | 说明 |
|---|---|
| **同 key 串行** | 同一 thread 的 drain 按 FIFO 顺序执行 |
| **异 key 并行** | 不同 thread 可以同时 drain |
| **run** | 显式 drain 请求，调用方等待结果 |
| **wake** | 合并式唤醒，已有 drain 则 coalesce 到下一轮 |
| **awaitIdle** | 等待当前 drain 链完全静默 |

参考：opencode `SessionRunCoordinator`

## 子代理生命周期

```
┌─────────────────────────────────────────────────────────┐
│  父线程（Parent Thread）                                  │
│                                                         │
│  1. 检测到子代理调用（tool_call to spawn agent）           │
│  2. 创建 SubagentMetadata（记录 parent/forked/role）      │
│  3. fork 出新线程（继承白名单历史）                         │
│  4. 向子代理线程发送 initial prompt                       │
│  5. 通过 run() 启动子代理 drain（并行）                    │
│     └─ 子代理独立执行，产生事件到自己的 event store         │
│  6. 子代理完成 → 发送 bounded completion to parent         │
│  7. 父线程收到 completion event（结构化 bounded 消息）     │
│  8. 父线程继续自己的 drain                                 │
└─────────────────────────────────────────────────────────┘
```

## 关键约束

1. **Bounded 通信**：子代理完成消息是有边界长度的摘要，不是完整 transcript
2. **不阻塞**：子代理 drain 与父线程 drain 并行（除非父线程显式 await）
3. **白名单继承**：fork 历史默认不包含 tool_call 等技术细节
4. **结构化事件**：子代理完成事件注入到父线程的 event store，作为结构化数据
