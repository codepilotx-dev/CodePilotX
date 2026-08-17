import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeFixturePaths } from "./fixture-cleanup"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { ToolExecutor, type ToolExecutorOptions, type ToolExecutionContext } from "../src/tool/ToolExecutor"
import { mergeToolGuards, type ToolGuardResult } from "../src/tool/ToolPipeline"
import { WorkspaceService } from "../src/workspace/WorkspaceService"
import type { ProcessResult } from "../src/tool/Shell/HostProcess"

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

const success = (): ProcessResult => ({ exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, truncated: false })

async function executionContext(root: string, overrides: Partial<ToolExecutionContext> = {}) {
  return {
    threadID: "thread",
    turnID: "turn",
    taskMode: "chat" as const,
    signal: new AbortController().signal,
    workspace: await WorkspaceService.open(root),
    ...overrides,
  }
}

const untrusted = { sandboxMode: "workspace-write" as const, approvalPolicy: "untrusted" as const, approvalsReviewer: "user" as const }

describe("统一工具执行管线", () => {
  test("guard 决策单调合并：deny > require-approval > continue", () => {
    expect(mergeToolGuards([{ kind: "continue" }, { kind: "continue" }])).toEqual({ kind: "continue" })
    expect(mergeToolGuards([{ kind: "continue" }, { kind: "require-approval", risk: "high", reason: "ask" }, { kind: "continue" }])).toEqual({ kind: "require-approval", risk: "high", reason: "ask" })
    expect(mergeToolGuards([{ kind: "deny", code: "G", reason: "no" }, { kind: "require-approval", risk: "high", reason: "ask" }, { kind: "continue" }])).toEqual({ kind: "deny", code: "G", reason: "no" })
    expect(mergeToolGuards([{ kind: "require-approval", risk: "medium", reason: "ask" }, { kind: "deny", code: "G", reason: "no" }])).toEqual({ kind: "deny", code: "G", reason: "no" })
    const guards: ToolGuardResult[] = [
      { kind: "deny", code: "G", reason: "hard" },
      { kind: "continue" },
    ]
    expect(mergeToolGuards(guards)).toEqual({ kind: "deny", code: "G", reason: "hard" })
  })

  test("guard deny 不能被后置 Hook 降级为 allow", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pipeline-guard-"))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const runs: string[] = []
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "允许" }),
      hooks: {
        run: async (event) => event === "pre_tool_use"
          ? [
              { result: { decision: "continue" as const } },
              { result: { decision: "deny" as const, reason: "blocked" } },
              { result: { decision: "continue" as const } },
            ]
          : [],
      },
      runHost: async (command) => {
        runs.push(command)
        return success()
      },
    })
    const context = await executionContext(root)
    await expect(executor.execute("Read", { file_path: "missing.txt" }, context)).rejects.toMatchObject({ code: "HOOK_DENIED", message: "blocked" })
    await expect(executor.execute("PowerShell", { command: "pwd" }, context)).rejects.toMatchObject({ code: "HOOK_DENIED", message: "blocked" })
    expect(runs).toEqual([])
  })

  test("Shell 与注册工具共享同一授权门禁，拒绝后都不执行", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pipeline-gate-"))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const context = await executionContext(root)
    const authorized: string[] = []
    let hostRuns = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      authorizeShell: async (invocation) => {
        authorized.push(invocation.name)
        return { decision: "deny", risk: "high", reason: "审批拒绝" }
      },
      runHost: async () => {
        hostRuns += 1
        return success()
      },
    })
    await expect(executor.execute("request_permissions", { scope: "tool-call", networkDomains: ["example.com"], justification: "测试" }, context)).rejects.toMatchObject({ code: "TOOL_PERMISSION_DENIED" })
    await expect(executor.execute("PowerShell", { command: "pwd" }, context)).rejects.toMatchObject({ code: "SHELL_PERMISSION_DENIED" })
    expect(authorized).toEqual(["request_permissions", "PowerShell"])
    expect(hostRuns).toBe(0)
  })

  test("authorizationOnly 完整执行解析与授权但不进入执行和 mutation 记录", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pipeline-preview-"))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const hookEvents: string[] = []
    const statuses: string[] = []
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      authorizeShell: async () => ({ decision: "allow", risk: "medium", reason: "允许" }),
      hooks: {
        run: async (event) => {
          hookEvents.push(event)
          return []
        },
      },
      recordToolCall: (_invocation, status) => { statuses.push(status) },
      runHost: async () => success(),
    })
    const decision = await executor.previewApproval("Write", { file_path: "created.txt", content: "preview" }, { ...await executionContext(root), permissionConfig: untrusted }, "tool-call")
    expect(decision).toMatchObject({ decision: "allow" })
    expect(await Bun.file(join(root, "created.txt")).exists()).toBe(false)
    expect(statuses).toEqual([])
    expect(hookEvents).toEqual(["pre_tool_use"])
  })

  test("finalize 对成功与失败各执行一次工具审计和 post Hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pipeline-finalize-"))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const hookEvents: string[] = []
    const statuses: string[] = []
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, ".agent-data"),
      authorizeShell: async () => ({ decision: "allow", risk: "medium", reason: "允许" }),
      hooks: {
        run: async (event) => {
          hookEvents.push(event)
          return []
        },
      },
      recordToolCall: (_invocation, status) => { statuses.push(status) },
      runHost: async () => success(),
    })
    const context = await executionContext(root)
    await executor.execute("Write", { file_path: "created.txt", content: "ok" }, context)
    expect(statuses).toEqual(["running", "completed"])
    expect(hookEvents).toEqual(["pre_tool_use", "post_tool_use"])

    statuses.length = 0
    hookEvents.length = 0
    await Bun.write(join(root, "stale.txt"), "old")
    await expect(executor.execute("Write", { file_path: "stale.txt", content: "new" }, context)).rejects.toMatchObject({ code: "WORKSPACE_FILE_STALE" })
    expect(statuses).toEqual(["running", "error"])
    expect(hookEvents).toEqual(["pre_tool_use", "post_tool_error"])
  })
})
