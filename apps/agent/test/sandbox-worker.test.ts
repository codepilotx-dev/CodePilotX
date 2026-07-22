import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { AgentError } from "../src/domain"
import { AnthropicSandboxRuntimeAdapter, sandboxPolicyFingerprint } from "../src/sandbox/SandboxRuntimeAdapter"

type FakeWorker = Omit<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr"> & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
}

type WorkerRequest = {
  requestId: string
  operation: "status" | "install" | "uninstall" | "reset" | "shutdown" | "run"
  request?: { config: Parameters<typeof sandboxPolicyFingerprint>[0] }
}

function fakeWorker(onRequest: (request: WorkerRequest, child: FakeWorker) => void): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter() as unknown as FakeWorker
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let killed = false
  Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    pid: undefined,
    exitCode: null,
    signalCode: null,
    killed: false,
    connected: false,
    kill: () => {
      if (killed) return true
      killed = true
      queueMicrotask(() => emitter.emit("exit", null, "SIGTERM"))
      return true
    },
    unref: () => emitter,
  })
  let pending = ""
  stdin.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8")
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""
    for (const line of lines) {
      if (line.trim()) onRequest(JSON.parse(line) as WorkerRequest, emitter)
    }
  })
  return emitter
}

function frame(requestId: string, value: Record<string, unknown>): string {
  return `${JSON.stringify({ requestId, ...value })}\n`
}

function resultFrame(requestId: string, value: unknown): string {
  return frame(requestId, { type: "result", value })
}

describe("sandbox worker isolation", () => {
  test("策略指纹忽略路径、域名顺序和重复项", () => {
    const left = {
      network: { allowedDomains: ["API.EXAMPLE.COM", "api.example.com"], deniedDomains: ["blocked.example.com"] },
      filesystem: {
        allowRead: ["C:\\workspace\\src", "C:\\workspace\\src\\"],
        allowWrite: ["C:\\workspace"],
        denyRead: ["C:\\workspace\\secret", "C:\\workspace\\private"],
        denyWrite: [],
      },
    }
    const right = {
      filesystem: {
        denyWrite: [],
        denyRead: ["C:\\workspace\\private", "C:\\workspace\\secret"],
        allowWrite: ["C:\\workspace\\"],
        allowRead: ["C:\\workspace\\src"],
      },
      network: { deniedDomains: ["blocked.example.com"], allowedDomains: ["api.example.com"] },
    }

    expect(sandboxPolicyFingerprint(left)).toBe(sandboxPolicyFingerprint(right))
  })

  test("setup 超时不会阻塞 Agent 事件循环，且命令阶段尚未开始", async () => {
    const events: string[] = []
    const adapter = new AnthropicSandboxRuntimeAdapter(null, {
      setupTimeoutMs: 100,
      logger: {
        info: (event) => events.push(event),
        warn: (event) => events.push(event),
        error: (event) => events.push(event),
      },
      spawnWorker: () => fakeWorker((request, child) => {
        child.stdout.write(frame(request.requestId, { type: "phase", phase: "setup" }))
        setTimeout(() => child.stdout.write(frame(request.requestId, { type: "phase", phase: "cleanup" })), 75)
      }),
    })
    const startedAt = Date.now()
    let heartbeats = 0
    const heartbeat = setInterval(() => { heartbeats += 1 }, 5)
    const cause = await adapter.getStatus().catch((error) => error)
    clearInterval(heartbeat)

    expect(cause).toBeInstanceOf(AgentError)
    expect((cause as AgentError).code).toBe("SANDBOX_SETUP_TIMEOUT")
    expect((cause as AgentError).details).toMatchObject({ phase: "setup" })
    expect(Date.now() - startedAt).toBeLessThan(150)
    expect(heartbeats).toBeGreaterThan(3)
    expect(events).toContain("sandbox.worker.timeout")
  })

  test("中止 worker 后队列可以执行下一次请求", async () => {
    let spawned = 0
    const adapter = new AnthropicSandboxRuntimeAdapter(null, {
      setupTimeoutMs: 2_000,
      spawnWorker: () => fakeWorker((request, child) => {
        spawned += 1
        if (spawned === 2) {
          child.stdout.write(resultFrame(request.requestId, {
            state: "unsupported",
            platform: process.platform,
            architecture: process.arch,
            runtimeVersion: "0.0.65",
            helperPath: null,
            helperSha256: null,
            user: null,
            wfp: null,
            error: null,
          }))
        }
      }),
    })
    const controller = new AbortController()
    const first = adapter.run({
      command: "never",
      cwd: process.cwd(),
      config: {
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: { allowRead: [], allowWrite: [], denyRead: [], denyWrite: [] },
      },
      signal: controller.signal,
    }).catch((error) => error)
    setTimeout(() => controller.abort(), 10)
    expect((await first as AgentError).code).toBe("RUN_ABORTED")
    expect((await adapter.getStatus()).state).toBe("unsupported")
    expect(spawned).toBe(2)
  })

  test("拒绝损坏的 worker 协议输出", async () => {
    const adapter = new AnthropicSandboxRuntimeAdapter(null, {
      spawnWorker: () => fakeWorker((_request, child) => child.stdout.write("not-json\n")),
    })
    const cause = await adapter.getStatus().catch((error) => error)
    expect(cause).toBeInstanceOf(AgentError)
    expect((cause as AgentError).code).toBe("SANDBOX_WORKER_PROTOCOL")
  })

  test("同一 worker 复用相同策略，切换策略后仍串行执行并在 dispose 时关闭", async () => {
    const events: string[] = []
    const operations: string[] = []
    let spawned = 0
    let activeFingerprint: string | null = null
    const adapter = new AnthropicSandboxRuntimeAdapter(null, {
      logger: {
        info: (event) => events.push(event),
        warn: (event) => events.push(event),
        error: (event) => events.push(event),
      },
      spawnWorker: () => {
        spawned += 1
        return fakeWorker((request, child) => {
          operations.push(request.operation)
          if (request.operation === "run") {
            const fingerprint = sandboxPolicyFingerprint(request.request!.config)
            if (activeFingerprint === fingerprint) {
              child.stdout.write(frame(request.requestId, { type: "session", event: "reused", fingerprint }))
            } else {
              if (activeFingerprint) child.stdout.write(frame(request.requestId, { type: "session", event: "switching", fingerprint, previousFingerprint: activeFingerprint }))
              activeFingerprint = fingerprint
              child.stdout.write(frame(request.requestId, { type: "session", event: "initialized", fingerprint }))
            }
            child.stdout.write(frame(request.requestId, { type: "phase", phase: "command" }))
            child.stdout.write(frame(request.requestId, { type: "phase", phase: "cleanup" }))
            child.stdout.write(resultFrame(request.requestId, { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, truncated: false }))
          } else if (request.operation === "shutdown") {
            activeFingerprint = null
            child.stdout.write(frame(request.requestId, { type: "session", event: "disposed", fingerprint: null }))
            child.stdout.write(resultFrame(request.requestId, null))
          }
        })
      },
    })
    const base = {
      command: "Write-Output ok",
      cwd: process.cwd(),
      config: {
        network: { allowedDomains: ["api.example.com"], deniedDomains: [] },
        filesystem: { allowRead: [process.cwd()], allowWrite: [process.cwd()], denyRead: [], denyWrite: [] },
      },
    }

    await adapter.run(base)
    await adapter.run({ ...base, config: { ...base.config, network: { allowedDomains: ["API.EXAMPLE.COM", "api.example.com"], deniedDomains: [] } } })
    await adapter.run({ ...base, config: { ...base.config, network: { allowedDomains: ["other.example.com"], deniedDomains: [] } } })
    await adapter.dispose()

    expect(spawned).toBe(1)
    expect(operations).toEqual(["run", "run", "run", "shutdown"])
    expect(events.filter((event) => event === "sandbox.session.initialized")).toHaveLength(2)
    expect(events).toContain("sandbox.session.reused")
    expect(events).toContain("sandbox.session.switching")
    expect(events).toContain("sandbox.session.disposed")
    await expect(adapter.run(base)).rejects.toMatchObject({ code: "SANDBOX_DISPOSED" })
  })
})
