import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { decodeApprovalPolicy, encodeApprovalPolicy } from "@codepilotx/shared/thread"
import type { ToolInvocation } from "../src/domain"
import { PermissionDecisionEngine } from "../src/permission/PermissionDecisionEngine"
import { generateSandboxPolicy, pathContains, safePathDirectories } from "../src/sandbox/SandboxPolicy"
import { secretScrubber } from "../src/security/SecretScrubber"
import { ToolRegistry } from "../src/tool/ToolRegistry"

const invocation = (overrides: Partial<ToolInvocation> = {}): ToolInvocation => ({
  id: "tool", threadID: "thread", turnID: "turn", agentID: "agent", name: "PowerShell", input: { command: "Get-ChildItem" },
  permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" }, taskMode: "chat",
  model: {} as ToolInvocation["model"], ...overrides,
})

describe("统一权限真值", () => {
  test("Codex approval policy 与 reviewer 决策矩阵", () => {
    const engine = new PermissionDecisionEngine()
    const shell = new ToolRegistry().get("PowerShell")
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
    const policy = { type: "granular", sandboxApproval: true, rules: false, skillApproval: false, requestPermissions: true, mcpTools: false, mcpElicitations: false } as const
    expect(decodeApprovalPolicy(encodeApprovalPolicy(policy))).toEqual(policy)
    const engine = new PermissionDecisionEngine()
    expect(engine.evaluate(invocation({ permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: policy, approvalsReviewer: "auto_review" } }), new ToolRegistry().get("PowerShell"))).toMatchObject({ action: "review", reviewer: "auto_review" })
    expect(engine.evaluate(invocation({ name: "request_permissions", input: { scope: "tool-call", justification: "need" }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: { ...policy, requestPermissions: false }, approvalsReviewer: "user" } }), new ToolRegistry().get("request_permissions"))).toMatchObject({ action: "deny", reason: expect.stringContaining("requestPermissions") })
    expect(engine.evaluate(invocation({ input: { command: "run-skill", __skillScript: true }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: { ...policy, skillApproval: true }, approvalsReviewer: "user" } }), new ToolRegistry().get("PowerShell"))).toMatchObject({ action: "review", reason: expect.stringContaining("skillApproval") })
    expect(engine.evaluate(invocation({ input: { command: "run-skill", __skillScript: true }, permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: { ...policy, skillApproval: false }, approvalsReviewer: "user" } }), new ToolRegistry().get("PowerShell"))).toMatchObject({ action: "deny", reason: expect.stringContaining("skillApproval") })
    const glob = new ToolRegistry().get("Glob")
    const permissionConfig = { sandboxMode: "workspace-write", approvalPolicy: { ...policy, mcpElicitations: true }, approvalsReviewer: "user" } as const
    const baseline = engine.evaluate(invocation({ input: { pattern: "*.ts" }, permissionConfig }), glob)
    const forged = engine.evaluate(invocation({ input: { pattern: "*.ts", __mcpElicitation: true }, permissionConfig }), glob)
    expect(forged).toEqual(baseline)
    expect(forged.reason).not.toContain("mcpElicitations")
  })

  test("MCP 工具权限使用结构化来源而不是名称前缀", () => {
    const engine = new PermissionDecisionEngine()
    const builtin = new ToolRegistry().get("Glob")
    const mcpTool = {
      ...builtin,
      sdkName: "remote_lookup",
      name: "remote_lookup",
      origin: {
        kind: "mcp" as const,
        serverName: "fixture",
        rawToolName: "lookup",
        generation: 1,
      },
    }
    const policy = {
      type: "granular" as const,
      sandboxApproval: false,
      rules: false,
      skillApproval: false,
      requestPermissions: false,
      mcpTools: false,
      mcpElicitations: true,
    }
    expect(engine.evaluate(invocation({
      name: "remote_lookup",
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: policy,
        approvalsReviewer: "user",
      },
    }), mcpTool)).toMatchObject({ action: "deny", reason: expect.stringContaining("mcpTools") })
    expect(engine.evaluate(invocation({
      name: "remote_lookup",
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: { ...policy, mcpTools: true },
        approvalsReviewer: "user",
      },
    }), mcpTool)).toMatchObject({ action: "review", reason: expect.stringContaining("mcpTools") })
    expect(engine.evaluate(invocation({
      name: "mcp_fake_prefix",
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: policy,
        approvalsReviewer: "user",
      },
    }), builtin)).not.toMatchObject({ reason: expect.stringContaining("mcpTools") })
    expect(engine.evaluate(invocation({
      name: "remote_lookup",
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
    }), { ...mcpTool, capabilities: { ...mcpTool.capabilities, externalState: true } }))
      .toMatchObject({ action: "review", risk: "high" })
  })

  test("Plan Shell 沿用任务原权限，显式写工具仍拒绝", () => {
    const catalog = new ToolRegistry()
    const engine = new PermissionDecisionEngine()
    expect(engine.evaluate(invocation({ taskMode: "plan" }), catalog.get("PowerShell"))).toMatchObject({ action: "allow" })
    expect(engine.evaluate(invocation({ name: "Write", taskMode: "plan", input: { file_path: "x", content: "x" } }), catalog.get("Write"))).toMatchObject({ action: "deny" })
  })
})

describe("沙箱与脱敏", () => {
  test("read-only 仅允许 session temp 写入，workspace-write 保护配置与技能目录", async () => {
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

      const protectedPaths = [
        join(workspace, ".codepilotx", "hooks.json"),
        join(workspace, ".codepilotx", "skills"),
        join(workspace, ".claude", "skills"),
        join(workspace, ".agents", "skills"),
      ]
      for (const protectedPath of protectedPaths) {
        expect(writable.config.filesystem?.denyWrite).toContain(resolve(protectedPath))

        const childOnly = generateSandboxPolicy({
          workspace,
          sessionTemp,
          dataDir,
          permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" },
          additionalPermissions: { writePaths: [join(protectedPath, "approved-child")] },
        })
        expect(childOnly.config.filesystem?.denyWrite).toContain(resolve(protectedPath))

        const exact = generateSandboxPolicy({
          workspace,
          sessionTemp,
          dataDir,
          permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" },
          additionalPermissions: { writePaths: [protectedPath] },
        })
        expect(exact.config.filesystem?.denyWrite).not.toContain(resolve(protectedPath))

        const ancestor = generateSandboxPolicy({
          workspace,
          sessionTemp,
          dataDir,
          permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" },
          additionalPermissions: { writePaths: [resolve(protectedPath, "..")] },
        })
        expect(ancestor.config.filesystem?.denyWrite).not.toContain(resolve(protectedPath))
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test("多根工作区在 workspace-write 下全部可写且逐根保护配置", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-multi-root-policy-"))
    try {
      const primary = join(root, "primary")
      const secondary = join(root, "secondary")
      const sessionTemp = join(root, "temp")
      const dataDir = join(root, "data")
      await Promise.all([mkdir(primary), mkdir(secondary), mkdir(sessionTemp), mkdir(dataDir)])
      const policy = generateSandboxPolicy({
        workspace: primary,
        workspaceRoots: [primary, secondary],
        sessionTemp,
        dataDir,
        permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" },
      })

      expect(policy.config.filesystem?.allowRead).toEqual([resolve(primary), resolve(secondary), resolve(sessionTemp)])
      expect(policy.config.filesystem?.allowWrite).toEqual([resolve(sessionTemp), resolve(primary), resolve(secondary)])
      for (const workspace of [primary, secondary]) {
        expect(policy.config.filesystem?.denyWrite).toContain(resolve(workspace, ".git", "config"))
        expect(policy.config.filesystem?.denyWrite).toContain(resolve(workspace, ".codepilotx", "config.toml"))
        expect(policy.config.filesystem?.denyWrite).toContain(resolve(workspace, ".codepilotx", "skills"))
      }
      const worktree = generateSandboxPolicy({
        workspace: primary,
        workspaceRoots: [primary, secondary],
        writableWorkspaceRoots: [primary],
        sessionTemp,
        dataDir,
        permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" },
      })
      expect(worktree.config.filesystem?.allowRead).toContain(resolve(secondary))
      expect(worktree.config.filesystem?.allowWrite).not.toContain(resolve(secondary))
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

  test("Windows 策略不把宿主 PATH 或外部系统目录写入 ACL", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-acl-policy-"))
    try {
      const workspace = join(root, "workspace")
      const sessionTemp = join(root, "temp")
      const dataDir = join(root, "data")
      const managedTool = join(root, "tooling", "git-bash")
      await Promise.all([
        mkdir(workspace),
        mkdir(sessionTemp),
        mkdir(dataDir),
        mkdir(managedTool, { recursive: true }),
      ])
      const policy = generateSandboxPolicy({
        workspace,
        sessionTemp,
        dataDir,
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          approvalsReviewer: "user",
        },
        trustedReadPaths: [managedTool],
      })
      const allowRead = policy.config.filesystem?.allowRead ?? []
      expect(allowRead).toEqual([
        resolve(workspace),
        resolve(sessionTemp),
        resolve(managedTool),
      ])
      expect(allowRead.some((path) => /System32|WindowsPowerShell|OpenSSH|Git[\\/]cmd/i.test(path))).toBe(false)
      if (process.platform === "win32") {
        expect(policy.config.filesystem?.denyRead).not.toContain(resolve(dataDir))
        expect(policy.config.filesystem?.denyWrite).not.toContain(resolve(dataDir))
        for (const externalRoot of [
          process.env.ProgramFiles,
          process.env.ProgramData,
          process.env.APPDATA,
        ].filter((path): path is string => Boolean(path))) {
          expect(policy.config.filesystem?.denyWrite).not.toContain(resolve(externalRoot))
        }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test("路径包含判断具有目录边界且 Windows 大小写不敏感", () => {
    expect(pathContains("C:\\Work\\Repo", "C:\\Work\\Repo\\src")).toBe(true)
    expect(pathContains("C:\\Work\\Repo", "C:\\Work\\Repository")).toBe(false)
    if (process.platform === "win32") {
      expect(pathContains("C:\\WORK\\REPO", "c:\\work\\repo\\src")).toBe(true)
    }
  })
})
