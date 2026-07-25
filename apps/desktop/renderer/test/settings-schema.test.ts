import { describe, expect, test } from "bun:test"
import {
  createSidebarStateResetPatch,
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
  SIDEBAR_STATE_VERSION,
} from "../shared/settingsSchema"

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

describe("宠物设置归一化", () => {
  test("提供安全默认值并限制尺寸与宠物 ID", () => {
    expect(defaultDesktopStoredSettings().pet).toEqual({
      enabled: false,
      selectedPetId: null,
      size: 112,
      notifyAttention: true,
      notifyCompletion: true,
      notifyFailure: true,
    })
    expect(
      normalizeDesktopStoredSettings({
        pet: {
          enabled: true,
          selectedPetId: "../unsafe",
          size: 500,
          notifyCompletion: false,
        },
      }).pet,
    ).toEqual({
      enabled: true,
      selectedPetId: null,
      size: 224,
      notifyAttention: true,
      notifyCompletion: false,
      notifyFailure: true,
    })
    expect(
      normalizeDesktopStoredSettings({
        pet: { selectedPetId: "little-whale", size: 40 },
      }).pet,
    ).toMatchObject({
      selectedPetId: "little-whale",
      size: 80,
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
      sidebarProductMode: "coding",
      sidebarStateVersion: 0,
      sidebarSessionPins: {},
      collapsedSidebarProjectPaths: [],
      sidebarSectionOrder: ["pinned", "projects", "recent"],
      collapsedSidebarSections: ["projects", "recent"],
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
          " recent ",
          "invalid",
          "recent",
          "pinned",
          123,
        ],
      }).sidebarSectionOrder,
    ).toEqual(["recent", "pinned", "projects"])
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

  test("保留合法的产品模式并回退非法值", () => {
    expect(normalizeDesktopStoredSettings({
      sidebarProductMode: "working",
      sidebarStateVersion: SIDEBAR_STATE_VERSION,
    })).toMatchObject({
      sidebarProductMode: "working",
      sidebarStateVersion: SIDEBAR_STATE_VERSION,
    })
    expect(normalizeDesktopStoredSettings({
      sidebarProductMode: "invalid",
    }).sidebarProductMode).toBe("coding")
  })

  test("一次性重置只替换侧边栏状态并保留工作空间和其他设置", () => {
    const settings = normalizeDesktopStoredSettings({
      model: "keep-model",
      sidebarProductMode: "working",
      recentWorkspaces: [{
        path: "F:\\CodeProject\\CodePilotX",
        name: "CodePilotX",
        pinnedAt: "2026-07-25T01:00:00.000Z",
      }],
      sidebarOrganization: "flat",
      sidebarSort: "manual",
      sidebarManualOrder: { all: ["session-1"] },
      sidebarSessionPins: { "session-1": "2026-07-25T01:00:00.000Z" },
      collapsedSidebarProjectPaths: ["F:\\CodeProject\\CodePilotX"],
      sidebarSectionOrder: ["recent", "projects", "pinned"],
      collapsedSidebarSections: ["pinned"],
    })

    const reset = { ...settings, ...createSidebarStateResetPatch(settings) }
    expect(reset).toMatchObject({
      model: "keep-model",
      sidebarProductMode: "working",
      sidebarStateVersion: SIDEBAR_STATE_VERSION,
      sidebarOrganization: "projects",
      sidebarSort: "priority",
      sidebarManualOrder: {},
      sidebarSessionPins: {},
      collapsedSidebarProjectPaths: [],
      sidebarSectionOrder: ["pinned", "projects", "recent"],
      collapsedSidebarSections: ["projects", "recent"],
    })
    expect(reset.recentWorkspaces).toMatchObject([{
      path: "F:\\CodeProject\\CodePilotX",
      name: "CodePilotX",
      pinnedAt: null,
    }])
  })
})

test("不再持久化 GitHub OAuth 客户端与认证服务地址", () => {
  const settings = normalizeDesktopStoredSettings({
    githubOAuthClientId: "legacy-client-id",
    authBaseUrl: "https://legacy.example.com",
  })

  expect("githubOAuthClientId" in settings).toBe(false)
  expect("authBaseUrl" in settings).toBe(false)
})
