import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { resolve } from "node:path"
import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"
import { AgentError } from "../src/domain"
import { sandboxWorkerSafeError } from "../src/sandbox/SandboxWorkerMain"
import {
  resolveSandboxWorkerCommand,
  sandboxWorkerEnvironment,
  SandboxWorkerPool,
} from "../src/sandbox/SandboxWorkerPool"
import {
  decodeSandboxWorkerRequest,
  decodeSandboxWorkerResponse,
  encodeSandboxWorkerFrame,
  MAX_SANDBOX_WORKER_FRAME_BYTES,
  SandboxWorkerFrameDecoder,
  type SandboxWorkerRequest,
} from "../src/sandbox/SandboxWorkerProtocol"
import { SRT_WORKER_PROTOCOL_VERSION } from "../src/sandbox/SandboxRuntimeManifest"

const config = (): SandboxRuntimeConfig => ({
  filesystem: {
    denyRead: [],
    allowRead: [resolve("workspace")],
    allowWrite: [resolve("workspace")],
    denyWrite: [],
    allowGitConfig: false,
  },
  network: {
    allowedDomains: [],
    deniedDomains: [],
    strictAllowlist: true,
    allowLocalBinding: false,
  },
  credentials: { envVars: [] },
  windows: {
    sandboxUser: "srt-sandbox",
    proxyPortRange: [60080, 60095],
    srtWin: { path: resolve("srt-win.exe") },
  },
} as SandboxRuntimeConfig)

const request = (command: string) => ({
  command,
  cwd: resolve("workspace"),
  config: config(),
})

const result = {
  exitCode: 0,
  signal: null,
  stdout: "ok",
  stderr: "",
  timedOut: false,
  truncated: false,
}

type StartedRun = {
  child: FakeChild
  message: Extract<SandboxWorkerRequest, { type: "run" }>
}

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  pid: undefined
  private input = ""
  private exited = false

  constructor(
    private readonly onRequest: (child: FakeChild, message: SandboxWorkerRequest) => void,
    ready = true,
  ) {
    super()
    this.stdin.on("data", (chunk: Buffer) => {
      this.input += chunk.toString("utf8")
      while (true) {
        const newline = this.input.indexOf("\n")
        if (newline < 0) break
        const line = this.input.slice(0, newline)
        this.input = this.input.slice(newline + 1)
        if (line) this.onRequest(this, decodeSandboxWorkerRequest(JSON.parse(line)))
      }
    })
    if (ready) {
      queueMicrotask(() => this.send({
        type: "ready",
        protocol: SRT_WORKER_PROTOCOL_VERSION,
      }))
    }
  }

  send(message: Parameters<typeof encodeSandboxWorkerFrame>[0]) {
    this.stdout.write(encodeSandboxWorkerFrame(message))
  }

  exit(code: number | null = 0) {
    if (this.exited) return
    this.exited = true
    queueMicrotask(() => this.emit("exit", code, null))
  }

  kill() {
    this.exit(null)
    return true
  }
}

class FakeWorkerFactory {
  readonly children: FakeChild[] = []
  readonly started: StartedRun[] = []

  constructor(private readonly ready = true) {}

  spawn = () => {
    const child = new FakeChild((source, message) => {
      if (message.type === "run") this.started.push({ child: source, message })
      if (message.type === "shutdown") source.exit(0)
    }, this.ready)
    this.children.push(child)
    return child as unknown as ChildProcessWithoutNullStreams
  }

  complete(run: StartedRun, recycle = false) {
    run.child.send({
      type: "result",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: run.message.id,
      result,
      recycle,
    })
  }
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待测试条件超时")
    await new Promise((resolveWait) => setTimeout(resolveWait, 1))
  }
}

describe("sandbox worker protocol", () => {
  test("校验 run/cancel/result/error 及协议版本和未知字段", () => {
    const run = decodeSandboxWorkerRequest({
      type: "run",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "run-1",
      request: request("Write-Output ok"),
    })
    expect(run.type).toBe("run")
    expect(decodeSandboxWorkerRequest({
      type: "cancel",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "run-1",
    }).type).toBe("cancel")
    expect(decodeSandboxWorkerResponse({
      type: "result",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "run-1",
      result,
      recycle: false,
    }).type).toBe("result")
    expect(decodeSandboxWorkerResponse({
      type: "error",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "run-1",
      error: { code: "SANDBOX_UNAVAILABLE", message: "failed", status: 503 },
    }).type).toBe("error")
    expect(() => decodeSandboxWorkerRequest({
      type: "cancel",
      protocol: SRT_WORKER_PROTOCOL_VERSION + 1,
      id: "run-1",
    })).toThrow("协议版本不匹配")
    expect(() => decodeSandboxWorkerRequest({
      type: "cancel",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "run-1",
      command: "secret",
    })).toThrow("未知字段")

    const frameDecoder = new SandboxWorkerFrameDecoder(decodeSandboxWorkerRequest)
    const encoded = Buffer.from(encodeSandboxWorkerFrame({
      type: "run",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "utf8",
      request: request("Write-Output 中文"),
    }))
    const decoded = [...encoded].flatMap((byte) => frameDecoder.push(Buffer.from([byte])))
    expect(decoded).toHaveLength(1)
    expect(decoded[0]).toMatchObject({ type: "run", request: { command: "Write-Output 中文" } })
  })

  test("拒绝相对路径、函数型配置、超大帧和畸形 result", () => {
    expect(() => decodeSandboxWorkerRequest({
      type: "run",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "relative",
      request: { ...request("ok"), cwd: "relative" },
    })).toThrow("绝对路径")
    expect(() => decodeSandboxWorkerRequest({
      type: "run",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "function",
      request: {
        ...request("ok"),
        config: { ...config(), network: { ...config().network, filterRequest: () => true } },
      },
    })).toThrow("不可序列化")
    expect(() => decodeSandboxWorkerRequest({
      type: "run",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "untrusted-env",
      request: { ...request("ok"), env: { API_TOKEN: "must-not-cross-worker-boundary" } },
    })).toThrow("env 无效")
    const decoder = new SandboxWorkerFrameDecoder(decodeSandboxWorkerRequest)
    expect(() => decoder.push("x".repeat(MAX_SANDBOX_WORKER_FRAME_BYTES + 1))).toThrow("1 MiB")
    expect(() => decodeSandboxWorkerResponse({
      type: "result",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: "bad",
      result: { ...result, exitCode: {} },
      recycle: false,
    })).toThrow("process result")
  })

  test("内部异常只返回脱敏错误，不泄漏命令、凭据或绝对路径", () => {
    const safe = sandboxWorkerSafeError(new Error(
      "token=super-secret; command=Remove-Item; path=C:\\Users\\private\\workspace",
    ))
    expect(safe).toEqual({
      code: "SANDBOX_UNAVAILABLE",
      message: "SRT 沙箱执行失败",
      status: 503,
    })
    expect(JSON.stringify(safe)).not.toContain("super-secret")
    expect(sandboxWorkerSafeError(new AgentError(
      "INTERNAL_FAILURE",
      "C:\\private\\helper.exe",
      500,
    )).message).toBe("SRT 沙箱执行失败")
  })
})

describe("sandbox worker pool", () => {
  test("开发态复用 Bun 入口，编译态只向当前 Agent exe 添加内部 worker 参数", () => {
    expect(resolveSandboxWorkerCommand({
      execPath: "C:\\Bun\\bun.exe",
      argv: ["C:\\Bun\\bun.exe", "F:\\CodePilotX\\apps\\agent\\src\\index.ts"],
      cwd: "F:\\CodePilotX",
    })).toEqual({
      executable: "C:\\Bun\\bun.exe",
      args: ["F:\\CodePilotX\\apps\\agent\\src\\index.ts", "--sandbox-worker"],
      cwd: "F:\\CodePilotX",
    })
    expect(resolveSandboxWorkerCommand({
      execPath: "F:\\CodePilotX\\dist\\codepilotx-agent.exe",
      argv: ["F:\\CodePilotX\\dist\\codepilotx-agent.exe"],
      cwd: "F:\\CodePilotX",
    })).toEqual({
      executable: "F:\\CodePilotX\\dist\\codepilotx-agent.exe",
      args: ["--sandbox-worker"],
      cwd: "F:\\CodePilotX",
    })
    expect(sandboxWorkerEnvironment({
      PATH: "C:\\Windows",
      OPENAI_API_KEY: "must-not-cross-worker-boundary",
      GITHUB_TOKEN: "must-not-cross-worker-boundary",
      SAFE_SETTING: "visible",
    })).toEqual({
      PATH: "C:\\Windows",
      SAFE_SETTING: "visible",
      CODEPILOTX_SANDBOX_WORKER: "1",
    })
  })

  test("8 条任务全部启动，第 9 条只等待全局容量", async () => {
    const factory = new FakeWorkerFactory()
    const pool = new SandboxWorkerPool({
      maxWorkers: 8,
      idleTimeoutMs: 0,
      spawnWorker: factory.spawn,
    })
    const jobs = Array.from({ length: 9 }, (_, index) => pool.run(request(`command-${index}`)))
    await waitFor(() => factory.started.length === 8)
    expect(factory.started.map((run) => run.message.request.command)).toEqual(
      Array.from({ length: 8 }, (_, index) => `command-${index}`),
    )
    expect(pool.stats()).toMatchObject({ active: 8, queued: 1, max: 8 })

    factory.complete(factory.started[0]!)
    await waitFor(() => factory.started.length === 9)
    expect(factory.started[8]!.message.request.command).toBe("command-8")
    for (const run of factory.started.slice(1)) factory.complete(run)
    await Promise.all(jobs)
    await pool.dispose()
  })

  test("单条命令只按需启动一个 worker", async () => {
    const factory = new FakeWorkerFactory()
    const pool = new SandboxWorkerPool({
      maxWorkers: 8,
      idleTimeoutMs: 0,
      spawnWorker: factory.spawn,
    })
    const job = pool.run(request("one"))
    await waitFor(() => factory.started.length === 1)
    expect(factory.children).toHaveLength(1)
    factory.complete(factory.started[0]!)
    await expect(job).resolves.toEqual(result)
    await pool.dispose()
  })

  test("释放一个 worker 后只启动 FIFO 队首任务", async () => {
    const factory = new FakeWorkerFactory()
    const pool = new SandboxWorkerPool({
      maxWorkers: 1,
      idleTimeoutMs: 0,
      spawnWorker: factory.spawn,
    })
    const first = pool.run(request("first"))
    const second = pool.run(request("second"))
    const third = pool.run(request("third"))
    await waitFor(() => factory.started.length === 1)
    factory.complete(factory.started[0]!)
    await waitFor(() => factory.started.length === 2)
    expect(factory.started.map((run) => run.message.request.command)).toEqual(["first", "second"])
    factory.complete(factory.started[1]!)
    await waitFor(() => factory.started.length === 3)
    expect(factory.started[2]!.message.request.command).toBe("third")
    factory.complete(factory.started[2]!)
    await Promise.all([first, second, third])
    await pool.dispose()
  })

  test("排队取消不会启动任务，运行取消超时只终止对应 worker", async () => {
    const factory = new FakeWorkerFactory()
    const pool = new SandboxWorkerPool({
      maxWorkers: 1,
      idleTimeoutMs: 0,
      cancelGraceMs: 10,
      spawnWorker: factory.spawn,
    })
    const activeController = new AbortController()
    const queuedController = new AbortController()
    const active = pool.run(request("active"), activeController.signal)
    const queued = pool.run(request("queued"), queuedController.signal)
    await waitFor(() => factory.started.length === 1)
    queuedController.abort()
    await expect(queued).rejects.toMatchObject({ code: "RUN_ABORTED" })
    expect(factory.started.map((run) => run.message.request.command)).toEqual(["active"])
    activeController.abort()
    await expect(active).rejects.toMatchObject({ code: "RUN_ABORTED" })
    await waitFor(() => factory.children.length === 1)
    await pool.dispose()
  })

  test("worker 崩溃不重试原命令，替换 worker 继续队首任务", async () => {
    const factory = new FakeWorkerFactory()
    const pool = new SandboxWorkerPool({
      maxWorkers: 1,
      idleTimeoutMs: 0,
      spawnWorker: factory.spawn,
    })
    const crashed = pool.run(request("side-effect"))
    const next = pool.run(request("next"))
    await waitFor(() => factory.started.length === 1)
    factory.started[0]!.child.exit(70)
    await expect(crashed).rejects.toMatchObject({ code: "SANDBOX_WORKER_CRASHED" })
    await waitFor(() => factory.started.length === 2)
    expect(factory.started.filter((run) => run.message.request.command === "side-effect")).toHaveLength(1)
    expect(factory.children).toHaveLength(2)
    factory.complete(factory.started[1]!)
    await expect(next).resolves.toEqual(result)
    await pool.dispose()
  })

  test("握手超时失败关闭，reset 失败标记 recycle 后更换 worker", async () => {
    const silentFactory = new FakeWorkerFactory(false)
    const unavailable = new SandboxWorkerPool({
      maxWorkers: 1,
      idleTimeoutMs: 0,
      readyTimeoutMs: 10,
      spawnWorker: silentFactory.spawn,
    })
    await expect(unavailable.run(request("never-starts"))).rejects.toMatchObject({
      code: "SANDBOX_WORKER_TIMEOUT",
    })
    await unavailable.dispose()

    const factory = new FakeWorkerFactory()
    const pool = new SandboxWorkerPool({
      maxWorkers: 1,
      idleTimeoutMs: 0,
      spawnWorker: factory.spawn,
    })
    const first = pool.run(request("reset-failed"))
    await waitFor(() => factory.started.length === 1)
    factory.complete(factory.started[0]!, true)
    await expect(first).resolves.toEqual(result)

    const second = pool.run(request("replacement"))
    await waitFor(() => factory.started.length === 2)
    expect(factory.children).toHaveLength(2)
    factory.complete(factory.started[1]!)
    await expect(second).resolves.toEqual(result)
    await pool.dispose()
  })
})
