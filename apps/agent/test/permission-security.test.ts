import { describe, expect, test } from "bun:test"
import { decodeApprovalPolicy, encodeApprovalPolicy } from "@codepilotx/shared/thread"
import type { ToolInvocation } from "../src/domain"
import { PermissionDecisionEngine } from "../src/permission/PermissionDecisionEngine"
import { secretScrubber } from "../src/security/SecretScrubber"
import { ToolRegistry } from "../src/tool/ToolRegistry"

const invocation = (overrides: Partial<ToolInvocation> = {}): ToolInvocation => ({
  id: "tool",
  threadID: "thread",
  turnID: "turn",
  agentID: "agent",
  name: "PowerShell",
  input: { command: "Get-ChildItem" },
  permissionConfig: {
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
  },
  taskMode: "chat",
  model: {} as ToolInvocation["model"],
  ...overrides,
})

describe("统一权限真值", () => {
  test("approval policy 与 reviewer 决策矩阵", () => {
    const engine = new PermissionDecisionEngine()
    const shell = new ToolRegistry().get("PowerShell")
    for (const reviewer of ["user", "auto_review"] as const) {
      expect(engine.evaluate(invocation({
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "untrusted",
          approvalsReviewer: reviewer,
        },
      }), shell)).toMatchObject({ action: "review", reviewer })
      expect(engine.evaluate(invocation({
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: reviewer,
        },
      }), shell)).toMatchObject({ action: "allow" })
      expect(engine.evaluate(invocation({
        input: {
          command: "npm view",
          additionalPermissions: { networkDomains: ["npmjs.org"] },
        },
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: reviewer,
        },
      }), shell)).toMatchObject({ action: "review", reviewer })
      expect(engine.evaluate(invocation({
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-failure",
          approvalsReviewer: reviewer,
        },
      }), shell)).toMatchObject({ action: "allow" })
      expect(engine.evaluate(invocation({
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          approvalsReviewer: reviewer,
        },
      }), shell)).toMatchObject({ action: "allow" })
      expect(engine.evaluate(invocation({
        input: {
          command: "npm view",
          additionalPermissions: { networkDomains: ["npmjs.org"] },
        },
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          approvalsReviewer: reviewer,
        },
      }), shell)).toMatchObject({ action: "deny" })
    }
  })

  test("granular 策略使用稳定 JSON 形状和编解码", () => {
    const policy = {
      type: "granular",
      sandboxApproval: true,
      rules: false,
      skillApproval: false,
      requestPermissions: true,
      mcpTools: false,
      mcpElicitations: false,
    } as const
    expect(decodeApprovalPolicy(encodeApprovalPolicy(policy))).toEqual(policy)
    const engine = new PermissionDecisionEngine()
    const catalog = new ToolRegistry()
    expect(engine.evaluate(invocation({
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: policy,
        approvalsReviewer: "auto_review",
      },
    }), catalog.get("PowerShell"))).toMatchObject({
      action: "review",
      reviewer: "auto_review",
    })
    expect(engine.evaluate(invocation({
      name: "request_permissions",
      input: { scope: "tool-call", justification: "need" },
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: { ...policy, requestPermissions: false },
        approvalsReviewer: "user",
      },
    }), catalog.get("request_permissions"))).toMatchObject({
      action: "deny",
      reason: expect.stringContaining("requestPermissions"),
    })
    expect(engine.evaluate(invocation({
      input: { command: "run-skill", __skillScript: true },
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: { ...policy, skillApproval: true },
        approvalsReviewer: "user",
      },
    }), catalog.get("PowerShell"))).toMatchObject({
      action: "review",
      reason: expect.stringContaining("skillApproval"),
    })
    expect(engine.evaluate(invocation({
      input: { command: "run-skill", __skillScript: true },
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: { ...policy, skillApproval: false },
        approvalsReviewer: "user",
      },
    }), catalog.get("PowerShell"))).toMatchObject({
      action: "deny",
      reason: expect.stringContaining("skillApproval"),
    })
    const glob = catalog.get("Glob")
    const permissionConfig = {
      sandboxMode: "workspace-write",
      approvalPolicy: { ...policy, mcpElicitations: true },
      approvalsReviewer: "user",
    } as const
    const baseline = engine.evaluate(invocation({ input: { pattern: "*.ts" }, permissionConfig }), glob)
    const forged = engine.evaluate(invocation({
      input: { pattern: "*.ts", __mcpElicitation: true },
      permissionConfig,
    }), glob)
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
    }), mcpTool)).toMatchObject({
      action: "deny",
      reason: expect.stringContaining("mcpTools"),
    })
    expect(engine.evaluate(invocation({
      name: "remote_lookup",
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: { ...policy, mcpTools: true },
        approvalsReviewer: "user",
      },
    }), mcpTool)).toMatchObject({
      action: "review",
      reason: expect.stringContaining("mcpTools"),
    })
    expect(engine.evaluate(invocation({
      name: "mcp_fake_prefix",
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: policy,
        approvalsReviewer: "user",
      },
    }), builtin)).not.toMatchObject({
      reason: expect.stringContaining("mcpTools"),
    })
    expect(engine.evaluate(invocation({
      name: "remote_lookup",
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
    }), {
      ...mcpTool,
      capabilities: { ...mcpTool.capabilities, externalState: true },
    })).toMatchObject({ action: "review", risk: "high" })
  })

  test("Plan 强制只读并禁止 Shell、权限提升和外部副作用", () => {
    const catalog = new ToolRegistry()
    const engine = new PermissionDecisionEngine()
    expect(engine.evaluate(invocation({
      taskMode: "plan",
      permissionConfig: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "on-failure",
        approvalsReviewer: "user",
      },
    }), catalog.get("PowerShell"))).toMatchObject({
      action: "deny",
      reason: expect.stringContaining("不允许"),
    })
    expect(engine.evaluate(invocation({
      name: "Write",
      taskMode: "plan",
      input: { file_path: "x", content: "x" },
    }), catalog.get("Write"))).toMatchObject({ action: "deny" })
    expect(engine.evaluate(invocation({
      name: "request_permissions",
      taskMode: "plan",
      input: { scope: "turn", justification: "need" },
    }), catalog.get("request_permissions"))).toMatchObject({
      action: "deny",
      reason: expect.stringContaining("禁止请求"),
    })
  })
})

describe("脱敏", () => {
  test("命令、对象字段和输出凭据统一脱敏", () => {
    expect(secretScrubber.scrubText("Authorization: Bearer abc.def.ghi")).toContain("<redacted>")
    expect(secretScrubber.scrub({
      command: "api_key=super-secret",
      stdout: "ghp_abcdefghijklmnopqrstuvwxyz",
      password: "raw",
    })).toEqual({
      command: "api_key=<redacted>",
      stdout: "<redacted>",
      password: "<redacted>",
    })
    const multiline = secretScrubber.scrubText(
      "password = \"value with spaces\"\nAuthorization: Basic dXNlcjpwYXNz\nnext=ok",
    )
    expect(multiline).toBe(
      "password = <redacted>\nAuthorization: <redacted>\nnext=ok",
    )
    expect(() => secretScrubber.assertSafeOpaqueState(
      '{"api_key":"secret value"}',
    )).toThrow("Opaque RunState")
  })
})
