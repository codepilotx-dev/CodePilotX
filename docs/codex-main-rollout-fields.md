# codex-main rollout 字段参考

本文记录 `D:\GitHubProject\codex-main` 中和 rollout 相关的主要字段。这里的
`rollout` 指 Codex 会话持久化的 JSONL 记录，以及协议、状态库里引用 rollout
文件或 rollout 标识的字段。

## JSONL 行结构

rollout 文件按 JSONL 存储。每一行是一个 `RolloutLine`：

```json
{
  "timestamp": "2026-06-30T12:00:00.000Z",
  "type": "session_meta",
  "payload": {}
}
```

顶层字段：

| 字段 | 含义 |
| --- | --- |
| `timestamp` | 写入该 rollout 行的时间。 |
| `type` | `RolloutItem` 类型。 |
| `payload` | 对应类型的具体内容。 |

定义位置：`codex-rs/protocol/src/protocol.rs` 中的 `RolloutLine` 和
`RolloutItem`。

## RolloutItem 类型

`type` 的主要取值：

| `type` | `payload` 内容 |
| --- | --- |
| `session_meta` | 会话级元数据，例如线程 ID、cwd、版本、来源、Git 信息等。 |
| `response_item` | 模型响应项，结构来自 `ResponseItem`。 |
| `inter_agent_communication` | 多代理通信记录。 |
| `compacted` | 上下文压缩记录。 |
| `turn_context` | 某个 turn 的可恢复运行上下文。 |
| `event_msg` | 运行事件，`payload.type` 表示具体事件类型。 |

## session_meta 字段

常见字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 当前 thread ID。 |
| `forked_from_id` | 如果是 fork 出来的 thread，记录来源 thread ID。 |
| `parent_thread_id` | 如果是 subagent，记录父 thread ID。 |
| `timestamp` | 会话元数据时间。 |
| `cwd` | 会话工作目录。 |
| `originator` | 会话来源程序。 |
| `cli_version` | 创建会话的 CLI 版本。 |
| `source` | 会话来源分类。 |
| `thread_source` | 可选的 analytics 来源分类。 |
| `agent_nickname` | subagent 的随机昵称。 |
| `agent_role` | subagent 的角色。旧字段 `agent_type` 会作为别名读取。 |
| `agent_path` | subagent 的 canonical agent path。 |
| `model_provider` | 模型 provider。 |
| `base_instructions` | 会话基础 instructions。 |
| `dynamic_tools` | 会话可用动态工具列表。 |
| `memory_mode` | memory 模式。 |
| `multi_agent_version` | 多代理协议版本，例如 `disabled`、`v1`、`v2`。 |
| `git` | 可选 Git 信息：`commit_hash`、`branch`、`repository_url`。 |

示例：

```json
{
  "timestamp": "2026-06-30T12:00:00.000Z",
  "type": "session_meta",
  "payload": {
    "id": "019cc2ea-1dff-7902-8d40-c8f6e5d83cc4",
    "timestamp": "2026-06-30T12:00:00.000Z",
    "cwd": "D:\\VueProject\\ClaudeCode",
    "originator": "codex",
    "cli_version": "0.0.0",
    "source": "cli",
    "model_provider": "openai",
    "multi_agent_version": "v2",
    "git": {
      "branch": "main"
    }
  }
}
```

## turn_context 字段

`turn_context` 用来在 resume/fork 时恢复最近一次稳定运行上下文。

| 字段 | 含义 |
| --- | --- |
| `turn_id` | 对应 turn ID。 |
| `cwd` | 当前 turn 的工作目录。 |
| `workspace_roots` | 有效 workspace roots。 |
| `current_date` | 当前日期字符串。 |
| `timezone` | 时区。 |
| `approval_policy` | 命令审批策略。 |
| `sandbox_policy` | 旧 sandbox 策略。 |
| `permission_profile` | 当前 canonical 权限配置。 |
| `network` | 网络策略摘要，含 `allowed_domains`、`denied_domains`。 |
| `file_system_sandbox_policy` | 文件系统 sandbox 策略。 |
| `model` | 当前模型。 |
| `comp_hash` | 上下文组件 hash。 |
| `personality` | 当前人格配置。 |
| `collaboration_mode` | 当前协作模式。 |
| `multi_agent_version` | 多代理版本。 |
| `multi_agent_mode` | 当前多代理模式。 |
| `realtime_active` | realtime 是否激活。 |
| `effort` | reasoning effort。 |
| `summary` | 兼容旧版本的 reasoning summary 配置。 |

示例：

```json
{
  "timestamp": "2026-06-30T12:01:00.000Z",
  "type": "turn_context",
  "payload": {
    "turn_id": "turn-1",
    "cwd": "D:\\VueProject\\ClaudeCode",
    "workspace_roots": ["D:\\VueProject\\ClaudeCode"],
    "current_date": "2026-06-30",
    "timezone": "Asia/Shanghai",
    "approval_policy": "never",
    "sandbox_policy": { "type": "danger-full-access" },
    "model": "gpt-5",
    "multi_agent_version": "v2",
    "summary": "auto"
  }
}
```

## compacted 字段

`compacted` 记录上下文压缩结果。

| 字段 | 含义 |
| --- | --- |
| `message` | 压缩后的摘要文本。 |
| `replacement_history` | 可选替代历史。 |
| `window_number` | 当前上下文窗口的单调序号。 |
| `first_window_id` | 第一个上下文窗口 ID。 |
| `previous_window_id` | 前一个上下文窗口 ID。 |
| `window_id` | 当前上下文窗口 ID。 |

兼容说明：旧 rollout 可能把数字窗口序号写在 `window_id`，读取时会迁移到
`window_number`。

## inter_agent_communication 字段

多代理通信记录字段：

| 字段 | 含义 |
| --- | --- |
| `author` | 发送方 agent path。 |
| `recipient` | 接收方 agent path。 |
| `other_recipients` | 其它接收方。 |
| `content` | 明文内容。 |
| `encrypted_content` | 可选加密内容。 |
| `metadata` | 可选响应元数据。 |
| `trigger_turn` | 是否触发接收方 turn。 |

## event_msg 常见事件

`event_msg` 本身的 rollout 行顶层 `type` 是 `event_msg`，具体事件在
`payload.type` 中。

常见 `payload.type`：

| `payload.type` | 说明 |
| --- | --- |
| `task_started` / `turn_started` | turn 开始。 |
| `task_complete` / `turn_complete` | turn 完成。 |
| `user_message` | 用户消息。 |
| `agent_message` | agent 输出消息。 |
| `agent_reasoning` | reasoning 文本。 |
| `token_count` | token 用量更新。 |
| `context_compacted` | 上下文已压缩。 |
| `thread_rolled_back` | 线程回滚。 |
| `exec_command_begin` | 命令开始执行。 |
| `exec_command_output_delta` | 命令输出增量。 |
| `terminal_interaction` | 终端交互记录。 |
| `exec_command_end` | 命令执行结束。 |
| `mcp_tool_call_begin` | MCP 工具调用开始。 |
| `mcp_tool_call_end` | MCP 工具调用结束。 |
| `web_search_begin` | Web 搜索开始。 |
| `web_search_end` | Web 搜索结束。 |
| `image_generation_begin` | 图片生成开始。 |
| `image_generation_end` | 图片生成结束。 |
| `request_user_input` | 请求用户输入。 |
| `request_permissions` | 请求权限。 |
| `apply_patch_approval_request` | 请求 apply patch 审批。 |
| `guardian_assessment` | Guardian 审批评估。 |

事件字段示例：

```json
{
  "timestamp": "2026-06-30T12:02:00.000Z",
  "type": "event_msg",
  "payload": {
    "type": "task_started",
    "turn_id": "turn-1",
    "trace_id": "trace-1",
    "started_at": 1780000000,
    "model_context_window": 200000,
    "collaboration_mode_kind": "default"
  }
}
```

```json
{
  "timestamp": "2026-06-30T12:03:00.000Z",
  "type": "event_msg",
  "payload": {
    "type": "task_complete",
    "turn_id": "turn-1",
    "last_agent_message": "完成",
    "completed_at": 1780000060,
    "duration_ms": 60000,
    "time_to_first_token_ms": 1200
  }
}
```

```json
{
  "timestamp": "2026-06-30T12:01:10.000Z",
  "type": "event_msg",
  "payload": {
    "type": "user_message",
    "client_id": "client-msg-1",
    "message": "你好",
    "images": null,
    "image_details": [],
    "local_images": [],
    "local_image_details": [],
    "text_elements": []
  }
}
```

## 其它 rollout 相关字段

这些字段名字里有 rollout，但不一定是 JSONL 行字段。

| 字段 | 出现位置 | 含义 |
| --- | --- | --- |
| `rollout_path` | protocol、core、state DB | rollout 文件路径。会话配置事件、线程状态、state DB 都会使用。 |
| `path` | app-server v2 `thread/resume`、`thread/fork` | 不稳定参数，用 rollout 文件路径 resume/fork。wire JSON 名为 `path`，不是 `rolloutPath`。 |
| `rollout_ids` | memory citation | memory citation 引用的 rollout/thread ID 列表。JSON 里是 `rolloutIds`。 |
| `rollout_summary` | state memory/stage1 outputs | memory pipeline 的 rollout 摘要文本。 |
| `rollout_slug` | state memory/stage1 outputs | rollout summary artifact 的可选 slug。 |
| `rollout_budget` | feature/config | rollout token budget 功能配置。 |

`rollout_budget` 配置字段：

| 字段 | 含义 |
| --- | --- |
| `enabled` | 是否启用。 |
| `limit_tokens` | token 上限，要求为正数。 |
| `reminder_interval_tokens` | 提醒间隔，要求为正数。 |
| `sampling_token_weight` | sampling token 权重，要求非负。 |
| `prefill_token_weight` | prefill token 权重，要求非负。 |

## 主要源码位置

| 路径 | 内容 |
| --- | --- |
| `codex-rs/protocol/src/protocol.rs` | `RolloutLine`、`RolloutItem`、`SessionMeta`、`TurnContextItem`、`EventMsg` 等核心协议结构。 |
| `codex-rs/protocol/src/compacted_item.rs` | `CompactedItem` 兼容反序列化逻辑。 |
| `codex-rs/rollout/src/recorder.rs` | rollout JSONL 写入逻辑。 |
| `codex-rs/app-server-protocol/src/protocol/v2/thread.rs` | `thread/resume`、`thread/fork` 中按 path 使用 rollout 的参数。 |
| `codex-rs/protocol/src/memory_citation.rs` | `rollout_ids` / `rolloutIds`。 |
| `codex-rs/state/migrations` | `rollout_path`、`rollout_summary`、`rollout_slug` 的数据库字段。 |
| `codex-rs/features/src/feature_configs.rs` | `rollout_budget` TOML 配置字段。 |
