import { fileURLToPath } from "node:url"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
const bunExecutable = process.execPath
const rendererURL = "http://127.0.0.1:7788"
const agentDataDir = resolve(
  process.env.CODEPILOTX_DATA_DIR?.trim()
    || join(homedir(), ".codepilotx"),
)
const agentLogDir = join(agentDataDir, "logs")

function configuredAgentPort() {
  const value = process.env.CODEPILOTX_DEV_AGENT_PORT?.trim()
  if (!value) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CODEPILOTX_DEV_AGENT_PORT 必须是 1 到 65535 的整数")
  }
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
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("无法分配 Agent 回环端口"))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function localNoProxy(value: string | undefined) {
  const entries = new Set((value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean))
  entries.add("127.0.0.1")
  entries.add("localhost")
  entries.add("::1")
  return [...entries].join(",")
}

type Child = ReturnType<typeof Bun.spawn>
const children: Child[] = []
let stopping = false

function spawn(command: string[], env: Record<string, string | undefined> = {}) {
  const noProxy = localNoProxy(process.env.NO_PROXY ?? process.env.no_proxy)
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy, ...env },
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  })
  children.push(child)
  return child
}

const alreadyTagged = (line: string) =>
  /^\d{2}:\d{2}:\d{2}\.\d{3} \[(?:agent|desktop)\]/.test(line)

const readySummary = (line: string) => {
  try {
    const value = JSON.parse(line) as { type?: unknown; url?: unknown; port?: unknown }
    if (value.type !== "ready") return null
    const location = typeof value.url === "string"
      ? value.url
      : typeof value.port === "number"
        ? `port=${value.port}`
        : "ready"
    return `[agent] 已就绪：${location}`
  } catch {
    return null
  }
}

async function forwardStream(
  stream: ReadableStream<Uint8Array> | number | null,
  label: string,
  errorOutput: boolean,
  onLine?: (line: string) => void,
) {
  if (!stream || typeof stream === "number") return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""
    for (const line of lines) {
      const formatted = readySummary(line)
        ?? (alreadyTagged(line) ? line : `[${label}] ${line}`)
      if (errorOutput) console.error(formatted)
      else console.log(formatted)
      onLine?.(line)
    }
  }
}

function forwardLines(child: Child, label: string, onLine?: (line: string) => void) {
  void forwardStream(child.stdout, label, false, onLine)
  void forwardStream(child.stderr, label, true)
}

async function waitForHTTP(name: string, url: string, headers: HeadersInit = {}) {
  const deadline = Date.now() + 20_000
  let lastFailure = "尚未建立连接"
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        console.log(`${name} 已就绪：${url}`)
        return
      }
      lastFailure = `HTTP ${response.status}`
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(150)
  }
  throw new Error(`${name} 启动超时（${url}）：${lastFailure}`)
}

function stopAll() {
  if (stopping) return
  stopping = true
  for (const child of children.toReversed()) {
    try {
      if (process.platform === "win32") {
        Bun.spawnSync(["taskkill.exe", "/PID", String(child.pid), "/T", "/F"], {
          stdout: "ignore",
          stderr: "ignore",
        })
      } else {
        child.kill()
      }
    } catch { /* process tree already exited */ }
  }
}

process.on("SIGINT", () => { stopAll(); process.exit(0) })
process.on("SIGTERM", () => { stopAll(); process.exit(0) })
process.on("exit", stopAll)

const authToken = crypto.randomUUID()
const agentPort = await allocateLoopbackPort()
const agentURL = `http://127.0.0.1:${agentPort}`
const renderer = spawn([bunExecutable, "run", "--cwd", "apps/desktop/renderer", "dev"])
forwardLines(renderer, "renderer")
const rendererExited = renderer.exited.then((code) => {
  throw new Error(`Renderer 开发服务已退出（code=${code}）`)
})

const agent = spawn([bunExecutable, "apps/agent/src/index.ts"], {
  PORT: String(agentPort),
  CODEPILOTX_PORT: String(agentPort),
  CODEPILOTX_AUTH_TOKEN: authToken,
  CODEPILOTX_DATA_DIR: agentDataDir,
  CODEPILOTX_PETS_DIR: join(agentDataDir, "pets"),
  CODEPILOTX_TOOLING_HOME: join(agentDataDir, "tooling"),
  CODEPILOTX_LEGACY_DATA_DIR: join(root, ".codepilotx"),
  CODEPILOTX_LOG_DIR: agentLogDir,
  CODEPILOTX_CONSOLE_LOG: "debug",
  CODEPILOTX_LOG_DETAIL: "development",
  CODEPILOTX_RENDERER_DIST: fileURLToPath(new URL("../dist/renderer", import.meta.url)),
  CODEPILOTX_RENDERER_DEV_URL: rendererURL,
})
forwardLines(agent, "agent")
const agentExited = agent.exited.then((code) => {
  throw new Error(`Agent sidecar 已退出（code=${code}）`)
})

try {
  await Promise.all([
    Promise.race([waitForHTTP("Renderer", rendererURL), rendererExited]),
    Promise.race([waitForHTTP("Agent sidecar", `${agentURL}/api/ready`, { Authorization: `Bearer ${authToken}` }), agentExited]),
  ])
  const electron = spawn([bunExecutable, "run", "--cwd", "apps/desktop/electron", "dev"], {
    CODEPILOTX_AGENT_URL: agentURL,
    CODEPILOTX_AGENT_MANAGED: "1",
    CODEPILOTX_AUTH_TOKEN: authToken,
    CODEPILOTX_BUN_PATH: process.execPath,
    CODEPILOTX_DATA_DIR: agentDataDir,
    CODEPILOTX_LOG_DIR: agentLogDir,
    CODEPILOTX_CONSOLE_LOG: "debug",
    CODEPILOTX_LOG_DETAIL: "development",
  })
  forwardLines(electron, "electron")
  const outcome = await Promise.race([
    electron.exited.then((code) => ({ source: "Electron", code })),
    renderer.exited.then((code) => ({ source: "Renderer", code })),
    agent.exited.then((code) => ({ source: "Agent", code })),
  ])
  if (outcome.source !== "Electron" || outcome.code !== 0) {
    console.error(`${outcome.source} 开发进程已退出（code=${outcome.code}）`)
  }
  stopAll()
  process.exit(outcome.source === "Electron" ? outcome.code : outcome.code || 1)
} catch (error) {
  console.error(error)
  stopAll()
  process.exit(1)
}
