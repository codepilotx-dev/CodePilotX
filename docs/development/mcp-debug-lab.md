# MCP 对话调试实验室

`codepilotx-debug` 是仓库内长期可用的确定性 MCP Server，用来验证 CodePilotX
的 MCP 连接、工具调用、资源读取、动态工具更新、错误隔离和对话编排。它不会调用真实模型，
也不会把记录写入磁盘。

## 快速开始

推荐使用 stdio。先生成可直接粘贴到“设置 → 插件 → MCP → 高级 JSON”的配置：

```powershell
bun run debug:mcp:config:stdio
```

保存配置并重载 MCP 后，可以让模型调用 `echo`，再通过 `mcp_list_resources` 和
`mcp_read_resource` 读取 `debug://calls` 检查模型实际传入的参数。配置中的
`diagnosticContext: true` 会让 CodePilotX 在 stdio 工具调用的 MCP `_meta` 中附加经过
脱敏和裁剪的当前会话摘要；调试 Server 会把最近一次摘要暴露为
`debug://context/latest`。

也可以单独启动 HTTP Server：

```powershell
bun run debug:mcp:http
bun run debug:mcp:config:http
```

HTTP 固定监听 `127.0.0.1:43121`，并保持黑盒模式，不接收 CodePilotX 内部会话摘要。
需要随机端口时直接运行：

```powershell
bun apps/agent/scripts/mcp-debug-server.ts --transport=http --port=0 --port-file=debug-mcp-port.txt
```

## 调试能力

- `echo`、`structured_result`：验证文本、structured content 和 resource link。
- `capture`、`assert_value`：记录模型输入并验证字段、字符串或诊断上下文。
- `conversation_configure`、`conversation_send`、`conversation_history`、
  `conversation_reset`：搭建确定性的多轮脚本对话。
- `delay`、`fail`、`large_result`、`disconnect`：验证超时、错误、截断和异常断连。
- `change_tools`：动态启停 `dynamic_echo` 并发送 `tools/list_changed`。
- `debug://status`、`debug://calls`、`debug://calls/{id}`、`debug://channels`、
  `debug://channels/{name}`、`debug://context/latest`：查看内存状态。

例如，可以依次对模型说：

1. “调用 codepilotx-debug 的 echo，传入 `MCP connection works`。”
2. “配置频道 `review`，回复依次是 `ask-details`、`found-cause`、`done`，然后连续发三条消息。”
3. “读取 `debug://channels/review`，核对三轮对话和 revision。”
4. “读取 `debug://context/latest`，确认当前会话摘要存在。”
5. “分别调用 delay、fail 和 large_result，验证超时、错误与结果截断。”

## 认证、日志和兼容参数

HTTP Bearer 认证只从宿主环境变量读取，避免 token 出现在命令行和日志中：

```powershell
$env:CODEPILOTX_DEBUG_MCP_TOKEN = "replace-me"
bun apps/agent/scripts/mcp-debug-server.ts --transport=http --auth-token-env=CODEPILOTX_DEBUG_MCP_TOKEN
```

配置时使用 HTTP transport 的 `bearerTokenEnvVar` 引用同一环境变量。默认日志只写入
stderr，包含调用 ID、工具名、状态、耗时和结果大小；`--verbose` 会额外打印经过
16 KiB 限制的输入预览。

只有现有测试 fixture 继续支持 `--auth-token=<value>`；共享调试 CLI 会明确拒绝该参数。
fixture 同时保留 `--legacy-sse`、
`--startup-delay=<ms>`、`--port=0` 和 `--port-file=<path>`。明文 `--auth-token`
仅用于仓库自动化测试，日常调试应使用 `--auth-token-env`。

所有调用记录和频道都在重启时清空。Server 最多保存 200 条调用、32 个频道和
1 MiB 状态，单个文本字段最多 16 KiB。
