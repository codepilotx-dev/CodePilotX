import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { agentDataDir, localNoProxy, readDevAgentRuntime, rendererDevURL, terminateProcessTree, verifyDevAgent } from "./dev-runtime"

const root = fileURLToPath(new URL("..", import.meta.url))
const unavailable = "未发现可用的开发 Agent。请先在另一个终端运行：bun run dev:agent"
type Child = ReturnType<typeof Bun.spawn>
const children: Child[] = []

function spawn(command: string[], env: Record<string, string | undefined> = {}) {
  const noProxy = localNoProxy(process.env.NO_PROXY ?? process.env.no_proxy)
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy, ...env },
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  })
  children.push(child)
  return child
}

async function waitForRenderer(child: Child) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(150).then(() => false)])
    if (exited) throw new Error("renderer exited")
    try {
      const response = await fetch(rendererDevURL, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch { /* keep waiting */ }
  }
  throw new Error("renderer timeout")
}

let stopping = false
function stopOwnedChildren() {
  if (stopping) return
  stopping = true
  for (const child of children.toReversed()) terminateProcessTree(child)
}
process.on("SIGINT", stopOwnedChildren)
process.on("SIGTERM", stopOwnedChildren)
process.on("exit", stopOwnedChildren)

try {
  const runtime = await readDevAgentRuntime()
  if (!await verifyDevAgent(runtime)) throw new Error("unavailable")
  const renderer = spawn([process.execPath, "run", "--cwd", "apps/desktop/renderer", "dev"])
  await waitForRenderer(renderer)
  const electron = spawn([process.execPath, "run", "--cwd", "apps/desktop/electron", "dev"], {
    CODEPILOTX_AGENT_URL: runtime.origin,
    CODEPILOTX_AGENT_MANAGED: "1",
    CODEPILOTX_AUTH_TOKEN: runtime.authToken,
    CODEPILOTX_BUN_PATH: process.execPath,
    CODEPILOTX_DATA_DIR: agentDataDir,
    CODEPILOTX_LOG_DIR: join(agentDataDir, "logs"),
    CODEPILOTX_CONSOLE_LOG: "debug",
    CODEPILOTX_LOG_DETAIL: "development",
  })
  const outcome = await Promise.race([
    electron.exited.then((code) => ({ source: "Electron", code })),
    renderer.exited.then((code) => ({ source: "Renderer", code })),
  ])
  if (outcome.source !== "Electron" || outcome.code !== 0) console.error(`${outcome.source} 开发进程已退出（code=${outcome.code}）`)
  stopOwnedChildren()
  process.exit(outcome.source === "Electron" ? outcome.code : outcome.code || 1)
} catch {
  console.error(unavailable)
  stopOwnedChildren()
  process.exit(1)
}
