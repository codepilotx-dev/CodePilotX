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

    await expect(executor.execute("shell", { command: "Write-Output blocked" }, await context(root))).rejects.toMatchObject({ code: "SHELL_PERMISSION_DENIED" })
    expect(runs).toBe(0)
  })

  test("允许后只把一次性工作区策略交给沙箱，默认不开放网络", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-shell-"))
    tempPaths.push(root)
    let received: SandboxedProcessRequest | null = null
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      sandbox: adapter(async (request) => {
        received = request
        return { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, truncated: false }
      }),
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "审核通过" }),
    })

    await executor.execute("shell", { command: "Write-Output ok" }, await context(root))
    expect(received).not.toBeNull()
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

    await expect(executor.execute("shell", { command: "Write-Output no-fallback" }, await context(root))).rejects.toThrow("SRT not ready")
    expect(runs).toBe(1)
  })
})
