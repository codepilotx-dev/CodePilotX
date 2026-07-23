import { describe, expect, test } from "bun:test"
import { defaultDesktopStoredSettings, normalizeDesktopStoredSettings } from "../shared/settingsSchema"

describe("工作空间依赖项迁移", () => {
  test("默认等待一次性迁移并持久化完成标记", () => {
    expect(defaultDesktopStoredSettings()).toMatchObject({
      installCodePilotXDependencies: true,
      workspaceDependenciesMigrated: false,
    })
    expect(normalizeDesktopStoredSettings({
      installCodePilotXDependencies: false,
      workspaceDependenciesMigrated: true,
    })).toMatchObject({
      installCodePilotXDependencies: false,
      workspaceDependenciesMigrated: true,
    })
  })
})

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

describe("侧边栏设置归一化", () => {
  test("提供完整默认值并迁移旧的 recent 排序", () => {
    const defaults = normalizeDesktopStoredSettings({})
    expect(defaults).toMatchObject({
      sidebarSort: "priority",
      sidebarSessionPins: {},
      collapsedSidebarProjectPaths: [],
      sidebarSectionOrder: ["pinned", "projects", "conversations"],
    })

    expect(normalizeDesktopStoredSettings({ sidebarSort: "recent" }).sidebarSort).toBe("updated")
    expect(normalizeDesktopStoredSettings({ sidebarSort: "updated" }).sidebarSort).toBe("updated")
    expect(normalizeDesktopStoredSettings({ sidebarSort: "created" }).sidebarSort).toBe("created")
    expect(normalizeDesktopStoredSettings({ sidebarSort: "invalid" }).sidebarSort).toBe("priority")
  })

  test("规范化并过滤会话置顶与折叠项目路径", () => {
    const settings = normalizeDesktopStoredSettings({
      sidebarSessionPins: {
        " se\u0301ssion ": " 2026-07-18T01:00:00Z ",
        "séssion": "duplicate",
        empty: " ",
        invalid: 123,
      },
      collapsedSidebarProjectPaths: [
        " C:\\Cafe\u0301 ",
        "C:\\Café",
        "",
        123,
        " C:\\Other ",
      ],
    })

    expect(settings.sidebarSessionPins).toEqual({
      "séssion": "2026-07-18T01:00:00.000Z",
    })
    expect(settings.collapsedSidebarProjectPaths).toEqual([
      "C:\\Café",
      "C:\\Other",
    ])
  })

  test("过滤 section order 非法项与重复项并补齐缺失 section", () => {
    expect(
      normalizeDesktopStoredSettings({
        sidebarSectionOrder: [
          " conversations ",
          "invalid",
          "conversations",
          "pinned",
          123,
        ],
      }).sidebarSectionOrder,
    ).toEqual(["conversations", "pinned", "projects"])
  })

  test("手动会话顺序规范化 UTF-8 并去重非法值", () => {
    expect(
      normalizeDesktopStoredSettings({
        sidebarManualOrder: {
          " proje\u0301ct ": [" se\u0301ssion ", "séssion", "", 123],
          invalid: "not-an-array",
        },
      }).sidebarManualOrder,
    ).toEqual({
      "projéct": ["séssion"],
    })
  })
})
