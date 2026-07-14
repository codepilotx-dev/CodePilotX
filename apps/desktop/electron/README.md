# CodePilotX Electron 壳

主进程只负责窗口安全配置与 Bun Agent sidecar 生命周期，不承载 Agent 业务逻辑。

## 环境变量

- `CODEPILOTX_AGENT_URL`：复用已由开发编排器启动的 Agent，例如 `http://127.0.0.1:43120`。设置后 Electron 不会重复启动或停止 sidecar。
- `CODEPILOTX_AGENT_MANAGED=1`：开发编排器的语义标记；实际是否复用由 `CODEPILOTX_AGENT_URL` 决定。
- `CODEPILOTX_RENDERER_URL`：供开发编排器传给 Agent 的 Vite 地址。Electron 始终加载 Agent URL，由 Agent 在开发时反代 Vite、生产时提供静态页面。
- `CODEPILOTX_AUTH_TOKEN`：可由开发编排器预先提供；未设置时主进程生成 256 位随机令牌。
- `CODEPILOTX_BUN_PATH`：开发时 Bun 可执行文件路径，默认 `bun`。
- `CODEPILOTX_AGENT_ENTRY`：开发时 Agent 入口，默认 `apps/agent/src/main.ts`。
- `CODEPILOTX_STATIC_DIR`：生产时由 Electron 自动指向 `extraResources/renderer`；开发时通常由 Agent 使用 `CODEPILOTX_RENDERER_URL` 反代 Vite。
- `CODEPILOTX_DEVTOOLS=1`：打包后显式启用 DevTools。

自行管理 sidecar 时，Agent 必须在 stdout 输出单行 UTF-8 JSON：

```json
{"type":"ready","host":"127.0.0.1","port":43120}
```

主进程随后轮询 `/health`，将认证令牌写入 `codepilotx_session` HttpOnly、SameSite=Strict Cookie，再加载页面。
