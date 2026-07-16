import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { decodeApprovalPolicy, encodeApprovalPolicy } from "@codepilotx/shared/thread"
import type { ToolInvocation } from "../src/domain"
import { PermissionDecisionEngine } from "../src/permission/PermissionDecisionEngine"
import { generateSandboxPolicy, safePathDirectories } from "../src/sandbox/SandboxPolicy"
import { secretScrubber } from "../src/security/SecretScrubber"
import { ToolRegistry } from "../src/tool/ToolRegistry"

const invocation = (overrides: Partial<ToolInvocation> = {}): ToolInvocation => ({
  id: "tool", threadID: "thread", turnID: "turn", agentID: "agent", name: "shell", input: { command: "Get-ChildItem" },
  permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" }, taskMode: "chat",
  model: {} as ToolInvocation["model"], ...overrides,
})

describe("统一权限真值", () => {
  test("Codex approval policy 与 reviewer 决策矩阵", () => {
    const engine = new PermissionDecisionEngine()
    const shell = new ToolRegistry().get("shell")
    for (const reviewer of ["user", "auto_review"] as const) {
      expect(engine.evaluate(invocation({ permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "untrusted", approvalsReviewer: reviewer } }), shell)).toMatchObject({ action: "review", reviewer })
      expect(engine.evaluate(invocation({ permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: reviewer } }), shell)).toMatchObject({ action: "allow" })
      expect(engine.evaluate(invocation({ input: { command: "npm view", additionalPermissions: { networkDomains: ["npmjs.org"] } }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: reviewer } }), shell)).toMatchObject({ action: "review", reviewer })
      expect(engine.evaluate(invocation({ permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-failure", approvalsReviewer: reviewer } }), shell)).toMatchObject({ action: "allow" })
      expect(engine.evaluate(invocation({ input: { command: "npm test", __sandboxFailureEscalation: true }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-failure", approvalsReviewer: reviewer } }), shell)).toMatchObject({ action: "review", reviewer })
      expect(engine.evaluate(invocation({ permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: reviewer } }), shell)).toMatchObject({ action: "allow" })
      expect(engine.evaluate(invocation({ input: { command: "npm view", additionalPermissions: { networkDomains: ["npmjs.org"] } }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: reviewer } }), shell)).toMatchObject({ action: "deny" })
    }
  })

  test("granular 策略使用稳定 JSON 形状和编解码", () => {
    const policy = { type: "granular", sandboxApproval: true, rules: false, skillApproval: false, requestPermissions: true, mcpElicitations: false } as const
    expect(decodeApprovalPolicy(encodeApprovalPolicy(policy))).toEqual(policy)
    const engine = new PermissionDecisionEngine()
    expect(engine.evaluate(invocation({ permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: policy, approvalsReviewer: "auto_review" } }), new ToolRegistry().get("shell"))).toMatchObject({ action: "review", reviewer: "auto_review" })
    expect(engine.evaluate(invocation({ name: "request_permissions", input: { scope: "tool-call", justification: "need" }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: { ...policy, requestPermissions: false }, approvalsReviewer: "user" } }), new ToolRegistry().get("request_permissions"))).toMatchObject({ action: "deny", reason: expect.stringContaining("requestPermissions") })
    expect(engine.evaluate(invocation({ input: { command: "run-skill", __skillScript: true }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: { ...policy, skillApproval: true }, approvalsReviewer: "user" } }), new ToolRegistry().get("shell"))).toMatchObject({ action: "review", reason: expect.stringContaining("skillApproval") })
    expect(engine.evaluate(invocation({ input: { command: "run-skill", __skillScript: true }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: { ...policy, skillApproval: false }, approvalsReviewer: "user" } }), new ToolRegistry().get("shell"))).toMatchObject({ action: "deny", reason: expect.stringContaining("skillApproval") })
    expect(engine.evaluate(invocation({ input: { command: "mcp", __mcpElicitation: true }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: { ...policy, mcpElicitations: true }, approvalsReviewer: "user" } }), new ToolRegistry().get("shell"))).toMatchObject({ action: "review", reason: expect.stringContaining("mcpElicitations") })
  })

  test("Plan Shell 沿用任务原权限，显式写工具仍拒绝", () => {
    const catalog = new ToolRegistry()
    const engine = new PermissionDecisionEngine()
    expect(engine.evaluate(invocation({ taskMode: "plan" }), catalog.get("shell"))).toMatchObject({ action: "allow" })
    expect(engine.evaluate(invocation({ name: "apply_patch", taskMode: "plan", input: { operation: "create", path: "x", content: "x" } }), catalog.get("apply_patch"))).toMatchObject({ action: "deny" })
  })
})

describe("沙箱与脱敏", () => {
  test("read-only 仅允许 session temp 写入，workspace-write 不封禁 git objects", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-policy-"))
    try {
      const workspace = join(root, "workspace")
      const sessionTemp = join(root, "temp")
      const dataDir = join(root, "data")
      await Promise.all([mkdir(workspace), mkdir(sessionTemp), mkdir(dataDir)])
      const readonly = generateSandboxPolicy({ workspace, sessionTemp, dataDir, permissionConfig: { sandboxMode: "read-only", approvalPolicy: "never", approvalsReviewer: "user" } })
      expect(readonly.config.filesystem?.allowWrite).toEqual([resolve(sessionTemp)])
      const writable = generateSandboxPolicy({ workspace, sessionTemp, dataDir, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" } })
      expect(writable.config.filesystem?.denyWrite).not.toContain(resolve(workspace, ".git", "objects"))
      expect(writable.config.filesystem?.denyWrite).toContain(resolve(workspace, ".git", "config"))
      const singleHook = generateSandboxPolicy({ workspace, sessionTemp, dataDir, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" }, additionalPermissions: { writePaths: [join(workspace, ".git", "hooks", "pre-commit")] } })
      expect(singleHook.config.filesystem?.denyWrite).toContain(resolve(workspace, ".git", "hooks"))
      const allHooks = generateSandboxPolicy({ workspace, sessionTemp, dataDir, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" }, additionalPermissions: { writePaths: [join(workspace, ".git", "hooks")] } })
      expect(allHooks.config.filesystem?.denyWrite).not.toContain(resolve(workspace, ".git", "hooks"))
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test("命令、对象字段和输出凭据统一脱敏", () => {
    expect(secretScrubber.scrubText("Authorization: Bearer abc.def.ghi")).toContain("<redacted>")
    expect(secretScrubber.scrub({ command: "api_key=super-secret", stdout: "ghp_abcdefghijklmnopqrstuvwxyz", password: "raw" })).toEqual({ command: "api_key=<redacted>", stdout: "<redacted>", password: "<redacted>" })
    const multiline = secretScrubber.scrubText("password = \"value with spaces\"\nAuthorization: Basic dXNlcjpwYXNz\nnext=ok")
    expect(multiline).toBe("password = <redacted>\nAuthorization: <redacted>\nnext=ok")
    expect(() => secretScrubber.assertSafeOpaqueState('{"api_key":"secret value"}')).toThrow("Opaque RunState")
  })

  test("PATH 仅规范化精确目录并拒绝根目录、用户目录和链接逃逸", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-path-"))
    try {
      const cwd = join(root, "cwd")
      const bin = join(cwd, "bin")
      const home = join(root, "home")
      const windowsRoot = join(root, "Windows")
      await Promise.all([mkdir(bin, { recursive: true }), mkdir(home), mkdir(windowsRoot)])
      const homeLink = join(cwd, "home-link")
      await symlink(home, homeLink, "junction")
      const paths = safePathDirectories({ path: ["bin", home, windowsRoot, homeLink, resolve(root).slice(0, 3)].join(";"), cwd, userHome: home, windowsRoot })
      expect(paths).toEqual([resolve(bin)])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
