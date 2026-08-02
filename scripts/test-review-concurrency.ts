import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process"
import { createInterface } from "node:readline"

const repositoryRoot = resolve(import.meta.dir, "..")
const activeChildren = new Set<ChildProcess>()
let isolatedRoot = ""
let succeeded = false
let cleaning = false

process.once("SIGINT", () => {
  void cleanup().finally(() => process.exit(130))
})
process.once("SIGTERM", () => {
  void cleanup().finally(() => process.exit(143))
})

try {
  isolatedRoot = await mkdtemp(
    join(tmpdir(), "codepilotx-review-concurrency-"),
  )
  const agentDataDir = join(isolatedRoot, "agent")
  await mkdir(agentDataDir, { recursive: true })

  process.stdout.write("[review-concurrency] 构建 Electron\n")
  await runBun(["run", "build:desktop"])

  const rendererOrigin = "http://127.0.0.1:47176"
  process.stdout.write("[review-concurrency] 启动 Renderer dev server\n")
  const renderer = startChild(
    [
      "run",
      "--cwd",
      "apps/desktop/renderer",
      "dev:performance",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      "47176",
      "--strictPort",
      "--force",
    ],
    {
      ...process.env,
      NODE_ENV: "production",
    },
  )
  await waitForHTTP(rendererOrigin, renderer, "Renderer dev server")

  const token = crypto.randomUUID()
  const agent = startAgent({
    ...process.env,
    CODEPILOTX_AUTH_TOKEN: token,
    CODEPILOTX_DATA_DIR: agentDataDir,
    CODEPILOTX_DOCUMENTS_DIR: join(isolatedRoot, "documents"),
    CODEPILOTX_LOG_DIR: join(isolatedRoot, "agent-logs"),
    CODEPILOTX_DESKTOP_MANAGED: "1",
    CODEPILOTX_PORT: "0",
    CODEPILOTX_RENDERER_DEV_URL: rendererOrigin,
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1",
  })
  const origin = await waitForAgent(agent)

  process.stdout.write(
    "[review-concurrency] 启动真实 Agent/Electron 并发 Review 验收\n",
  )
  await runBun(
    [
      "run",
      "--cwd",
      "apps/desktop/electron",
      "test:review-concurrency",
    ],
    {
      ...process.env,
      CODEPILOTX_AGENT_URL: origin,
      CODEPILOTX_AUTH_TOKEN: token,
      CODEPILOTX_DATA_DIR: agentDataDir,
      CODEPILOTX_REVIEW_CONCURRENCY_ROOT: isolatedRoot,
      CODEPILOTX_PLAYWRIGHT_OUTPUT_DIR: join(
        isolatedRoot,
        "playwright",
      ),
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  )
  succeeded = true
  process.stdout.write("[review-concurrency] 全链路验收通过\n")
} catch (cause) {
  process.stderr.write(
    `[review-concurrency] ${errorMessage(cause)}\n`,
  )
  if (isolatedRoot) {
    process.stderr.write(
      `[review-concurrency] 已保留失败现场：${isolatedRoot}\n`,
    )
  }
  process.exitCode = 1
} finally {
  await cleanup()
}

async function runBun(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  })
  activeChildren.add(child)
  const code = await new Promise<number | null>((resolveCode, reject) => {
    child.once("error", reject)
    child.once("exit", resolveCode)
  }).finally(() => activeChildren.delete(child))
  if (code !== 0) {
    throw new Error(
      `命令执行失败 (${code ?? "signal"})：bun ${args.join(" ")}`,
    )
  }
}

function startAgent(environment: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(
    process.execPath,
    ["apps/agent/scripts/review-concurrency-server.ts"],
    {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  )
  activeChildren.add(child)
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk)
  })
  return child
}

function startChild(
  args: string[],
  environment: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  })
  activeChildren.add(child)
  child.once("exit", () => activeChildren.delete(child))
  return child
}

async function waitForHTTP(
  origin: string,
  child: ChildProcess,
  label: string,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 60_000) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} 提前退出`)
    }
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {
      // Continue until the bounded startup timeout.
    }
    await Bun.sleep(100)
  }
  throw new Error(`${label} 在 60 秒内未就绪`)
}

async function waitForAgent(child: ChildProcess): Promise<string> {
  if (!child.stdout) {
    throw new Error("无法读取 Review concurrency Agent 启动输出")
  }
  const lines = createInterface({ input: child.stdout })
  return new Promise<string>((resolveReady, rejectReady) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error("Review concurrency Agent 在 60 秒内未就绪"))
    }, 60_000)
    const finish = (result: string | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      lines.close()
      if (result instanceof Error) rejectReady(result)
      else resolveReady(result)
    }
    lines.on("line", (line) => {
      let message: { type?: string; origin?: string } | null = null
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        process.stdout.write(`${line}\n`)
      }
      if (
        message?.type === "review-concurrency-ready"
        && typeof message.origin === "string"
      ) {
        finish(message.origin)
      }
    })
    child.once("error", (cause) =>
      finish(
        new Error(
          `Review concurrency Agent 启动失败：${errorMessage(cause)}`,
        ),
      ),
    )
    child.once("exit", (code) => {
      activeChildren.delete(child)
      finish(
        new Error(
          `Review concurrency Agent 提前退出 (${code ?? "signal"})`,
        ),
      )
    })
  })
}

async function cleanup(): Promise<void> {
  if (cleaning) return
  cleaning = true
  for (const child of [...activeChildren]) killProcessTree(child)
  activeChildren.clear()
  if (succeeded && isolatedRoot) {
    await rm(isolatedRoot, { recursive: true, force: true })
  }
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
  } else {
    child.kill("SIGTERM")
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

if (
  process.platform === "win32"
  && !existsSync(process.execPath)
) {
  throw new Error("Review concurrency 测试未找到 Bun 可执行文件")
}
