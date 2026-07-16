import { describe, expect, test } from "bun:test"
import { normalizeDesktopStoredSettings } from "../shared/settingsSchema"

describe("高级权限设置归一化", () => {
  test("完整保存并回填 granular PermissionConfig", () => {
    const granular = { type: "granular" as const, sandboxApproval: false, rules: true, skillApproval: false, requestPermissions: true, mcpElicitations: false }
    const settings = normalizeDesktopStoredSettings({
      permissionMode: "custom", sandboxMode: "danger-full-access", permissionProfile: ":danger-full-access",
      approvalPolicy: granular, approvalsReviewer: "auto_review",
    })
    expect(settings).toMatchObject({
      permissionConfig: { sandboxMode: "danger-full-access", approvalPolicy: granular, approvalsReviewer: "auto_review" },
    })
    expect(settings).not.toHaveProperty("permissionMode")
    expect(settings).not.toHaveProperty("permissionProfile")
    expect(settings).not.toHaveProperty("sandboxMode")
    expect(settings).not.toHaveProperty("approvalPolicy")
    expect(settings).not.toHaveProperty("approvalsReviewer")
  })

  test("旧 permissionProfile 可回填 sandboxMode", () => {
    expect(normalizeDesktopStoredSettings({ permissionMode: "custom", permissionProfile: ":read-only" }).permissionConfig.sandboxMode).toBe("read-only")
    expect(normalizeDesktopStoredSettings({ permissionMode: "custom", sandboxMode: "full-access" }).permissionConfig.sandboxMode).toBe("danger-full-access")
  })

  test("旧 on-failure 审批策略迁移为 on-request", () => {
    expect(normalizeDesktopStoredSettings({ approvalPolicy: "on-failure" }).permissionConfig.approvalPolicy).toBe("on-request")
  })
})
