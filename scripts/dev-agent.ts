import { createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  acquireDevAgentLock, agentDataDir, cleanupDevAgentRuntime, localNoProxy,
  publishDevAgentRuntime, rendererDevURL, terminateProcessTree,
} from "./dev-runtime"

const root = fileURLToPath(new URL("..", import.meta.url))
const authToken = crypto.randomUUID()
const instanceToken = crypto.randomUUID()

function configuredAgentPort() {
  const value = process.env.CODEPILOTX_DEV_AGENT_PORT?.trim()
  if (!value) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid configured port")
  return port
}

async function allocateLoopbackPort() {
  const configured = configuredAgentPort()
  if (configured) return configured
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address()
      if (!address || typeof address === "string") return server.close(() => reject(new Error("port allocation failed")))
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function forwardStream(stream: ReadableStream<Uint8Array> | number | null, errorOutput: boolean, onLine?: (line: string) => void) {
  if (!stream || typeof stream === "number") return Promise.resolve()
  return (async () => {
    const reader = stream.getReader()
    const decoder = new TextDecoder("utf-8")
    let pending = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const line of lines) {
        onLine?.(line)
        if (errorOutput) console.error(line)
        else if (!line.includes('"type":"ready"')) console.log(line)
      }
    }
  })()
}

async function run() {
  await acquireDevAgentLock(instanceToken)
  const port = await allocateLoopbackPort()
  const origin = `http://127.0.0.1:${port}`
  const noProxy = localNoProxy(process.env.NO_PROXY ?? process.env.no_proxy)
  const agentLogDir = join(agentDataDir, "logs")
  const agent = Bun.spawn([process.execPath, "apps/agent/src/index.ts"], {
    cwd: root,
    env: {
      ...process.env, NO_PROXY: noProxy, no_proxy: noProxy,
      PORT: String(port), CODEPILOTX_PORT: String(port),
      CODEPILOTX_AUTH_TOKEN: authToken,
      CODEPILOTX_DESKTOP_MANAGED: "1",
      CODEPILOTX_SIDECAR_INSTANCE_TOKEN: instanceToken,
      CODEPILOTX_DATA_DIR: agentDataDir,
      CODEPILOTX_PETS_DIR: join(agentDataDir, "pets"),
      CODEPILOTX_TOOLING_HOME: join(agentDataDir, "tooling"),
      CODEPILOTX_BUILTIN_SKILLS_DIR: join(root, "apps", "agent", "resources", "skills"),
      CODEPILOTX_LEGACY_DATA_DIR: join(root, ".codepilotx"),
      CODEPILOTX_LOG_DIR: agentLogDir,
      CODEPILOTX_CONSOLE_LOG: "debug",
      CODEPILOTX_LOG_DETAIL: "development",
      CODEPILOTX_RENDERER_DIST: fileURLToPath(new URL("../dist/renderer", import.meta.url)),
      CODEPILOTX_RENDERER_DEV_URL: rendererDevURL,
    },
    stdin: "inherit", stdout: "pipe", stderr: "pipe",
  })

  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const readyTimeout = setTimeout(() => rejectReady(new Error("agent timeout")), 20_000)
  void agent.exited.then((code) => rejectReady(new Error(`agent exited ${code}`)))
  void forwardStream(agent.stdout, false, (line) => {
    try {
      const value = JSON.parse(line) as { type?: unknown; port?: unknown; url?: unknown; instanceToken?: unknown }
      if (value.type !== "ready") return
      if (value.port !== port || value.url !== origin || value.instanceToken !== instanceToken) {
        rejectReady(new Error("ready identity mismatch"))
      } else resolveReady()
    } catch { /* normal Agent log line */ }
  })
  void forwardStream(agent.stderr, true)

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    terminateProcessTree(agent)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  try {
    await ready
    clearTimeout(readyTimeout)
    const response = await fetch(`${origin}/api/ready`, {
      headers: { Authorization: `Bearer ${authToken}` }, signal: AbortSignal.timeout(1_000),
    })
    const body = await response.json() as { instanceToken?: unknown }
    if (!response.ok || body.instanceToken !== instanceToken) throw new Error("health identity mismatch")
    await publishDevAgentRuntime({ schemaVersion: 1, ownerPid: process.pid, agentPid: agent.pid, origin, authToken, instanceToken, rendererDevUrl: rendererDevURL })
    console.log("开发 Agent 已就绪。现在可在另一个终端运行：bun run dev:desktop")
    const code = await agent.exited
    if (!stopping && code !== 0) process.exitCode = code || 1
  } finally {
    clearTimeout(readyTimeout)
    stop()
    await cleanupDevAgentRuntime(instanceToken)
  }
}

try {
  await run()
} catch (error) {
  await cleanupDevAgentRuntime(instanceToken)
  const code = error instanceof Error ? error.message : ""
  console.error(code === "AGENT_ALREADY_RUNNING" ? "开发 Agent 已在运行。" : code === "AGENT_LOCKED" ? "另一个开发 Agent 正在启动或仍持有启动锁。" : "开发 Agent 启动失败。")
  process.exit(1)
}
