import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { PermissionGrantStore, intersectPermissionGrant } from "../src/permission/PermissionGrantStore"
import type { SandboxedProcessRequest } from "../src/sandbox/SandboxRuntimeAdapter"
import { ToolExecutor } from "../src/tool/ToolExecutor"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { WorkspaceService } from "../src/workspace/WorkspaceService"

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("临时权限授权", () => {
  test("request_permissions schema 支持 session 且拒绝空权限请求", () => {
    const schema = new ToolRegistry().get("request_permissions").schema
    expect(schema.parse({ scope: "session", networkDomains: ["api.example.com"], justification: "允许 API" })).toMatchObject({ scope: "session" })
    expect(() => schema.parse({ scope: "turn", justification: "没有具体权限" })).toThrow()
  })

  test("用户授权只能缩小模型请求", () => {
    expect(intersectPermissionGrant(
      {
        readPaths: ["C:\\repo"],
        writePaths: ["C:\\repo\\output"],
        networkDomains: ["example.com"],
      },
      {
        readPaths: ["C:\\repo\\src", "C:\\"],
        writePaths: ["C:\\repo\\output\\result.txt", "C:\\repo"],
        networkDomains: ["api.example.com", "other.example"],
      },
    )).toEqual({
      readPaths: ["C:\\repo\\src"],
      writePaths: ["C:\\repo\\output\\result.txt"],
      networkDomains: ["api.example.com"],
    })
  })

  test("tool-call 只消费一次，turn 不跨 turn，session 仅按 thread 生效", () => {
    const store = new PermissionGrantStore()
    const permissions = { readPaths: ["C:\\repo"], writePaths: [], networkDomains: [] }
    store.grant({ threadID: "thread", turnID: "turn-1", agentID: "agent", scope: "tool-call", requested: permissions, granted: permissions })
    expect(store.authorize({ threadID: "thread", turnID: "turn-1", agentID: "agent", requested: permissions, consumeToolCall: true })?.scope).toBe("tool-call")
    expect(store.authorize({ threadID: "thread", turnID: "turn-1", agentID: "agent", requested: permissions, consumeToolCall: true })).toBeNull()

    store.grant({ threadID: "thread", turnID: "turn-1", agentID: "agent", scope: "turn", requested: permissions, granted: permissions })
    expect(store.authorize({ threadID: "thread", turnID: "turn-2", agentID: "agent", requested: permissions })).toBeNull()

    store.grant({ threadID: "thread", turnID: "turn-1", agentID: "agent", scope: "session", requested: permissions, granted: permissions })
    expect(store.authorize({ threadID: "thread", turnID: "turn-2", agentID: "other-agent", requested: permissions })?.scope).toBe("session")
    expect(store.authorize({ threadID: "other-thread", turnID: "turn-2", agentID: "agent", requested: permissions })).toBeNull()
  })

  test("获批的 tool-call 权限被下一次 Shell 消费且不会重复审批", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codepilotx-permission-grant-"))
    temporary.push(parent)
    const workspaceRoot = join(parent, "workspace")
    const outsideRoot = join(parent, "outside")
    await Promise.all([mkdir(workspaceRoot), mkdir(outsideRoot)])
    await writeFile(join(outsideRoot, "fixture.txt"), "fixture", "utf8")
    const sandboxRequests: SandboxedProcessRequest[] = []
    let approvals = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(parent, "agent-data"),
      sandbox: {
        getStatus: async () => ({ state: "available" as const, platform: "win32" as const, architecture: "x64", runtimeVersion: "test", helperPath: null, helperSha256: null, user: null, wfp: null, error: null }),
        refreshStatus: async () => ({ state: "available" as const, platform: "win32" as const, architecture: "x64", runtimeVersion: "test", helperPath: null, helperSha256: null, user: null, wfp: null, error: null }),
        install: async () => undefined,
        uninstall: async () => undefined,
        dispose: async () => undefined,
        run: async (request) => {
          sandboxRequests.push(request)
          return { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, truncated: false }
        },
      },
      authorizeShell: async () => {
        approvals += 1
        return { decision: "allow", risk: "low", reason: "test fallback" }
      },
    })
    const context = {
      threadID: "thread",
      turnID: "turn",
      agentID: "agent",
      taskMode: "chat" as const,
      signal: new AbortController().signal,
      workspace: await WorkspaceService.open(workspaceRoot),
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" } as const,
    }

    await executor.execute("request_permissions", {
      scope: "tool-call",
      readPaths: [outsideRoot],
      justification: "读取测试 fixture",
    }, { ...context, toolCallID: "permission-call", approvedToolCallID: "permission-call" })

    const shellInput = { command: "Write-Output ok", additionalPermissions: { readPaths: [outsideRoot] } }
    await executor.execute("PowerShell", shellInput, context)
    expect(approvals).toBe(0)
    expect(sandboxRequests[0]?.config.filesystem?.allowRead).toContain(resolve(outsideRoot))

    await executor.execute("PowerShell", shellInput, context)
    expect(approvals).toBe(1)
  })
})
