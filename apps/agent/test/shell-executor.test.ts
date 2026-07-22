import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PermissionConfig } from "@codepilotx/shared/thread"
import { ToolExecutor } from "../src/tool/ToolExecutor"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { WorkspaceService } from "../src/workspace/WorkspaceService"
import type { ProcessResult, SandboxedProcessRequest } from "../src/sandbox/SandboxRuntimeAdapter"

const tempPaths: string[] = []
afterEach(async () => Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

const config: PermissionConfig = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
}

const adapter = (onRun: (request: SandboxedProcessRequest) => Promise<ProcessResult>) => ({
  getStatus: async () => ({ state: "available" as const, platform: "win32" as const, architecture: "x64", runtimeVersion: "0.0.65", helperPath: null, helperSha256: null, user: null, wfp: null, error: null }),
  install: async () => undefined,
  uninstall: async () => undefined,
  reset: async () => undefined,
  dispose: async () => undefined,
  run: onRun,
})

async function context(root: string, permissionConfig = config) {
  return {
    threadID: "thread",
    turnID: "turn",
    taskMode: "chat" as const,
    signal: new AbortController().signal,
    workspace: await WorkspaceService.open(root),
    permissionConfig,
  }
}

describe("统一 Shell 执行门", () => {
  test("人工审批未允许前绝不调用沙箱进程", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-shell-"))
    tempPaths.push(root)
    let runs = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      sandbox: adapter(async () => {
        runs += 1
        return { exitCode: 0, signal: null, stdout: "must-not-run", stderr: "", timedOut: false, truncated: false }
      }),
      authorizeShell: async () => ({ decision: "deny", risk: "medium", reason: "等待人工审批" }),
    })

    await expect(executor.execute("PowerShell", { command: "Write-Output blocked" }, await context(root))).rejects.toMatchObject({ code: "SHELL_PERMISSION_DENIED" })
    expect(runs).toBe(0)
  })

  test("允许后只把一次性工作区策略交给沙箱，默认不开放网络", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-shell-"))
    tempPaths.push(root)
    let received: SandboxedProcessRequest | null = null
    let audited: { name: string; input: Record<string, unknown> } | null = null
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      sandbox: adapter(async (request) => {
        received = request
        return { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, truncated: false }
      }),
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "审核通过" }),
      recordToolCall: (invocation, status) => { if (status === "running") audited = invocation },
    })

    await executor.execute("PowerShell", { command: "Write-Output ok", timeout: 1_234, description: "测试命令" }, await context(root))
    expect(received).not.toBeNull()
    expect(received!.timeoutMs).toBe(1_234)
    expect(audited).toMatchObject({ name: "PowerShell", input: { justification: "测试命令" } })
    const policy = received!.config
    expect(policy.filesystem.allowWrite).toContain(root)
    expect(policy.network.allowedDomains).toEqual([])
  })

  test("沙箱失败时向上返回错误，不回退到宿主进程", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-shell-"))
    tempPaths.push(root)
    let runs = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      sandbox: adapter(async () => {
        runs += 1
        throw new Error("SRT not ready")
      }),
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "审核通过" }),
    })

    await expect(executor.execute("PowerShell", { command: "Write-Output no-fallback" }, await context(root))).rejects.toThrow("SRT not ready")
    expect(runs).toBe(1)
  })

  test("PreToolUse 可阻止执行，PostToolUse 失败不覆盖成功或原始错误", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-shell-"))
    tempPaths.push(root)
    let runs = 0
    const preDenied = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      sandbox: adapter(async () => { runs += 1; return { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, truncated: false } }),
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "允许" }),
      hooks: { run: async (event) => event === "pre_tool_use" ? [{ result: { decision: "deny", reason: "blocked" } }] : [] },
    })
    await expect(preDenied.execute("PowerShell", { command: "Write-Output blocked" }, await context(root))).rejects.toMatchObject({ code: "HOOK_DENIED" })
    expect(runs).toBe(0)

    const success = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      sandbox: adapter(async () => ({ exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, truncated: false })),
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "允许" }),
      hooks: { run: async (event) => { if (event === "post_tool_use") throw new Error("post failed"); return [] } },
    })
    await expect(success.execute("PowerShell", { command: "Write-Output ok" }, await context(root))).resolves.toMatchObject({ stdout: "ok" })

    const originalFailure = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      sandbox: adapter(async () => { throw new Error("original sandbox failure") }),
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "允许" }),
      hooks: { run: async (event) => { if (event === "post_tool_error") throw new Error("post failed"); return [] } },
    })
    await expect(originalFailure.execute("PowerShell", { command: "Write-Output fail" }, await context(root))).rejects.toThrow("original sandbox failure")
  })

  test("on-failure 生成两阶段 escalation，sandbox 一次且 host 最多一次", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-shell-"))
    tempPaths.push(root)
    let sandboxRuns = 0
    let hostRuns = 0
    let stored: { token: string; invocation: import("../src/domain").ToolInvocation; invocationHash: string; failure: string; claimed: boolean } | null = null
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      sandbox: adapter(async () => { sandboxRuns += 1; throw new Error("sandbox denied") }),
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "sandbox first" }),
      prepareSandboxEscalation: (invocation) => {
        stored = { token: "11111111-1111-4111-8111-111111111111", invocation, invocationHash: "test-hash", failure: "sandbox denied", claimed: false }
        return { token: stored.token }
      },
      claimSandboxEscalation: (token, scope) => {
        if (!stored || stored.claimed || token !== stored.token || scope.turnID !== stored.invocation.turnID) return null
        stored.claimed = true
        return stored
      },
      completeSandboxEscalation: () => undefined,
      runHost: async () => { hostRuns += 1; return { exitCode: 0, signal: null, stdout: "host-ok", stderr: "", timedOut: false, truncated: false } },
    })
    const onFailure = { ...config, approvalPolicy: "on-failure" as const }
    const executionContext = await context(root, onFailure)
    const first = await executor.execute<ProcessResult>("PowerShell", { command: "Write-Output once" }, executionContext)
    expect(first).toMatchObject({ exitCode: 126 })
    expect(first.stderr).toContain("request_permissions")
    expect(sandboxRuns).toBe(1)
    expect(hostRuns).toBe(0)
    const token = stored!.token
    await expect(executor.executeSandboxEscalation(token, executionContext)).resolves.toMatchObject({ stdout: "host-ok" })
    await expect(executor.executeSandboxEscalation(token, executionContext)).rejects.toMatchObject({ code: "SANDBOX_ESCALATION_INVALID" })
    expect(sandboxRuns).toBe(1)
    expect(hostRuns).toBe(1)
  })
})
