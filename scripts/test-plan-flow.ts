import { Database } from "bun:sqlite"
import {
  existsSync,
} from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"

const repositoryRoot = resolve(import.meta.dir, "..")
const rpcOnly = process.argv.includes("--rpc")
const live = process.argv.includes("--live")
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
  if (rpcOnly) {
    await runBun(["apps/agent/scripts/pi-rpc-smoke.ts"])
    succeeded = true
  } else {
    if (!live) {
      process.stdout.write("[plan-test] 先执行确定性 RPC/事件检查\n")
      await runBun(["apps/agent/scripts/pi-rpc-smoke.ts"])
    }

    isolatedRoot = await mkdtemp(join(tmpdir(), "codepilotx-plan-flow-"))
    const agentDataDir = join(isolatedRoot, "agent")
    const documentsDir = join(isolatedRoot, "documents")
    await Promise.all([
      mkdir(agentDataDir, { recursive: true }),
      mkdir(documentsDir, { recursive: true }),
    ])
    if (live) {
      await prepareLiveProfile(agentDataDir)
      process.stdout.write("[plan-test] 已创建正式 profile 的在线快照；正式数据不会被修改\n")
    }

    process.stdout.write("[plan-test] 构建 Renderer\n")
    await runBun(["run", "build:renderer"])
    process.stdout.write("[plan-test] 构建 Electron\n")
    await runBun(["run", "build:desktop"])

    const token = crypto.randomUUID()
    const agent = startAgent({
      ...process.env,
      CODEPILOTX_AUTH_TOKEN: token,
      CODEPILOTX_DATA_DIR: agentDataDir,
      CODEPILOTX_DOCUMENTS_DIR: documentsDir,
      CODEPILOTX_LOG_DIR: join(isolatedRoot, "agent-logs"),
      CODEPILOTX_DESKTOP_MANAGED: "1",
      CODEPILOTX_PORT: "0",
      CODEPILOTX_PLAN_SMOKE_LIVE: live ? "1" : "0",
      ...(live
        ? {}
        : { OPENAI_API_KEY: "codepilotx-plan-smoke-not-a-real-key" }),
      CODEPILOTX_STATIC_DIR: join(repositoryRoot, "dist", "renderer"),
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    })
    const origin = await waitForAgent(agent)

    process.stdout.write(
      live
        ? "[plan-test] 启动真实模型 Electron 流程（会联网并产生模型费用）\n"
        : "[plan-test] 启动 faux Electron 全流程\n",
    )
    await runBun(
      ["run", "--cwd", "apps/desktop/electron", "test:plan"],
      {
        ...process.env,
        CODEPILOTX_AGENT_URL: origin,
        CODEPILOTX_AUTH_TOKEN: token,
        CODEPILOTX_DATA_DIR: agentDataDir,
        CODEPILOTX_PLAN_SMOKE_ROOT: isolatedRoot,
        CODEPILOTX_PLAN_SMOKE_LIVE: live ? "1" : "0",
        CODEPILOTX_PLAYWRIGHT_OUTPUT_DIR: join(
          isolatedRoot,
          "playwright",
        ),
        NO_PROXY: "127.0.0.1,localhost,::1",
        no_proxy: "127.0.0.1,localhost,::1",
      },
    )
    succeeded = true
    process.stdout.write("[plan-test] Plan 桌面全流程通过\n")
  }
} catch (cause) {
  process.stderr.write(`[plan-test] ${errorMessage(cause)}\n`)
  if (isolatedRoot) {
    process.stderr.write(
      `[plan-test] 已保留失败现场（trace、screenshot、脱敏日志）：${isolatedRoot}\n`,
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
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  }).finally(() => activeChildren.delete(child))
  if (code !== 0) {
    throw new Error(`命令执行失败 (${code ?? "signal"})：bun ${args.join(" ")}`)
  }
}

function startAgent(environment: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(
    process.execPath,
    ["apps/agent/scripts/plan-smoke-server.ts"],
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

async function waitForAgent(child: ChildProcess): Promise<string> {
  if (!child.stdout) throw new Error("无法读取 Plan smoke Agent 启动输出")
  const lines = createInterface({ input: child.stdout })
  return new Promise<string>((resolveReady, rejectReady) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error("Plan smoke Agent 在 60 秒内未就绪"))
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
        message?.type === "plan-smoke-ready"
        && typeof message.origin === "string"
      ) {
        finish(message.origin)
      }
    })
    child.once("error", (cause) => finish(new Error(
      `Plan smoke Agent 启动失败：${errorMessage(cause)}`,
    )))
    child.once("exit", (code) => {
      activeChildren.delete(child)
      finish(new Error(`Plan smoke Agent 提前退出 (${code ?? "signal"})`))
    })
  })
}

async function prepareLiveProfile(targetDataDir: string): Promise<void> {
  const sourceDataDir = resolve(
    process.env.CODEPILOTX_PLAN_LIVE_SOURCE_DIR?.trim()
      || join(homedir(), ".codepilotx"),
  )
  const sourceProfile = join(sourceDataDir, "profile.sqlite")
  const sourceConfig = join(sourceDataDir, "config.json")
  if (!existsSync(sourceProfile) || !existsSync(sourceConfig)) {
    throw new Error(
      `真实模型测试需要 ${sourceDataDir} 中的 profile.sqlite 和 config.json`,
    )
  }

  const database = new Database(sourceProfile, {
    readonly: true,
    strict: true,
  })
  try {
    await writeFile(
      join(targetDataDir, "profile.sqlite"),
      database.serialize(),
    )
  } finally {
    database.close()
  }
  await writeFile(
    join(targetDataDir, "config.json"),
    await readFile(sourceConfig),
  )
}

async function cleanup(): Promise<void> {
  if (cleaning) return
  cleaning = true
  for (const child of [...activeChildren]) {
    killProcessTree(child)
  }
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
