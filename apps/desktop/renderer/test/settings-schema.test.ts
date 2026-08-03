import { describe, expect, test } from "bun:test"
import {
  createSidebarStateResetPatch,
  DEFAULT_PROJECT_APPEARANCE,
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
  PROJECT_APPEARANCE_COLORS,
  PROJECT_APPEARANCE_ICONS,
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

describe("系统通知设置归一化", () => {
  test("提供安全默认值：完成仅失焦，其余默认开启", () => {
    expect(defaultDesktopStoredSettings().notifications).toEqual({
      completion: "unfocused",
      permissions: true,
      questions: true,
      errors: true,
    })
  })

  test("完整保存并往返保留全部字段", () => {
    const saved = {
      completion: "always",
      permissions: false,
      questions: true,
      errors: false,
    }
    expect(
      normalizeDesktopStoredSettings({ notifications: saved }).notifications,
    ).toEqual(saved)
  })

  test("旧配置缺字段时按字段回填默认值", () => {
    expect(
      normalizeDesktopStoredSettings({
        notifications: { completion: "never" },
      }).notifications,
    ).toEqual({
      completion: "never",
      permissions: true,
      questions: true,
      errors: true,
    })
    expect(
      normalizeDesktopStoredSettings({ notifications: {} }).notifications,
    ).toEqual(defaultDesktopStoredSettings().notifications)
  })

  test("非法 completion 值回退 unfocused，非对象输入整体回退默认", () => {
    expect(
      normalizeDesktopStoredSettings({
        notifications: { completion: "sometimes" },
      }).notifications.completion,
    ).toBe("unfocused")
    expect(
      normalizeDesktopStoredSettings({ notifications: "on" }).notifications,
    ).toEqual(defaultDesktopStoredSettings().notifications)
    expect(
      normalizeDesktopStoredSettings({}).notifications,
    ).toEqual(defaultDesktopStoredSettings().notifications)
  })
})

describe("高级权限设置归一化", () => {
  test("Shell 安全级别默认平衡并只保留合法档位", () => {
    expect(defaultDesktopStoredSettings().shellSecurityLevel).toBe("balanced")
    for (const shellSecurityLevel of ["strict", "balanced", "relaxed"] as const) {
      expect(normalizeDesktopStoredSettings({ shellSecurityLevel }).shellSecurityLevel)
        .toBe(shellSecurityLevel)
    }
    expect(normalizeDesktopStoredSettings({
      shellSecurityLevel: "future" as never,
    }).shellSecurityLevel).toBe("balanced")
  })

  test("完整保存并回填 granular PermissionConfig", () => {
    const granular = { type: "granular" as const, sandboxApproval: false, rules: true, skillApproval: false, requestPermissions: true, mcpTools: false, mcpElicitations: false }
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

describe("集成终端设置归一化", () => {
  test("默认自动选择 Shell，并只保留字符串 profile ID", () => {
    expect(defaultDesktopStoredSettings().terminalProfileId).toBeNull()
    expect(
      normalizeDesktopStoredSettings({ terminalProfileId: "windows-pwsh" })
        .terminalProfileId,
    ).toBe("windows-pwsh")
    expect(
      normalizeDesktopStoredSettings({ terminalProfileId: 42 as never })
        .terminalProfileId,
    ).toBeNull()
  })
})

describe("侧边栏设置归一化", () => {
  test("提供侧栏默认值并保留合法组织与排序设置", () => {
    const defaults = normalizeDesktopStoredSettings({})
    expect(defaults).toMatchObject({
      sidebarOrganization: "projects",
      sidebarProjectSort: "priority",
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
    expect(normalizeDesktopStoredSettings({ sidebarSort: "created" }).sidebarSort).toBe("updated")
    expect(normalizeDesktopStoredSettings({ sidebarSort: "invalid" }).sidebarSort).toBe("priority")
    expect(normalizeDesktopStoredSettings({ sidebarProjectSort: "recent" }).sidebarProjectSort).toBe("updated")
    expect(normalizeDesktopStoredSettings({ sidebarProjectSort: "created" }).sidebarProjectSort).toBe("updated")
    expect(normalizeDesktopStoredSettings({ sidebarProjectSort: "manual" }).sidebarProjectSort).toBe("manual")
    expect(normalizeDesktopStoredSettings({ sidebarProjectSort: "invalid" }).sidebarProjectSort).toBe("priority")
    expect(normalizeDesktopStoredSettings({ sidebarOrganization: "flat" }).sidebarOrganization).toBe("flat")
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

  test("丢弃旧 section order 并恢复固定区段顺序", () => {
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
    ).toEqual(["pinned", "projects", "recent"])
  })

  test("规范化并保留手动顺序", () => {
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
    for (const sidebarProductMode of ["coding", "working", "chat"] as const) {
      expect(normalizeDesktopStoredSettings({
        sidebarProductMode,
        sidebarStateVersion: SIDEBAR_STATE_VERSION,
      })).toMatchObject({
        sidebarProductMode,
        sidebarStateVersion: SIDEBAR_STATE_VERSION,
      })
    }
    expect(normalizeDesktopStoredSettings({
      sidebarProductMode: "invalid",
    }).sidebarProductMode).toBe("coding")
  })

  test("一次性重置只替换侧边栏状态并保留工作空间和其他设置", () => {
    const settings = normalizeDesktopStoredSettings({
      model: "keep-model",
      sidebarProductMode: "chat",
      recentWorkspaces: [{
        path: "F:\\CodeProject\\CodePilotX",
        name: "CodePilotX",
        pinnedAt: "2026-07-25T01:00:00.000Z",
      }],
      sidebarOrganization: "flat",
      sidebarProjectSort: "updated",
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
      sidebarProductMode: "chat",
      sidebarStateVersion: SIDEBAR_STATE_VERSION,
      sidebarOrganization: "projects",
      sidebarProjectSort: "priority",
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
  test("在默认设置中聚焦筛选默认关闭", () => {
    expect(normalizeDesktopStoredSettings({}).sidebarPriorityFilterEnabled).toBe(
      false,
    )
  })

  test("旧设置缺字段时默认关闭，非法值回退关闭", () => {
    expect(
      normalizeDesktopStoredSettings({}).sidebarPriorityFilterEnabled,
    ).toBe(false)
    expect(
      normalizeDesktopStoredSettings({
        sidebarPriorityFilterEnabled: "yes",
      }).sidebarPriorityFilterEnabled,
    ).toBe(false)
    expect(
      normalizeDesktopStoredSettings({
        sidebarPriorityFilterEnabled: 1,
      }).sidebarPriorityFilterEnabled,
    ).toBe(false)
  })

  test("true 能通过归一化并保留保存快照", () => {
    const settings = normalizeDesktopStoredSettings({
      sidebarPriorityFilterEnabled: true,
    })
    expect(settings.sidebarPriorityFilterEnabled).toBe(true)
    expect(
      normalizeDesktopStoredSettings(settings).sidebarPriorityFilterEnabled,
    ).toBe(true)
  })

  test("重置侧栏状态会关闭聚焦筛选视图", () => {
    const settings = normalizeDesktopStoredSettings({
      sidebarPriorityFilterEnabled: true,
    })
    const reset = {
      ...settings,
      ...createSidebarStateResetPatch(settings),
    }
    expect(reset.sidebarPriorityFilterEnabled).toBe(false)
  })
})

describe("项目外观本地设置归一化", () => {
  test("默认不为任何项目创建外观覆盖", () => {
    expect(defaultDesktopStoredSettings().projectAppearances).toEqual({})
    expect(PROJECT_APPEARANCE_COLORS).toContain("default")
    expect(PROJECT_APPEARANCE_ICONS).toHaveLength(30)
    expect(PROJECT_APPEARANCE_ICONS).toContain("folder")
  })

  test("保留合法语义 ID，并过滤空项目 ID 和非对象记录", () => {
    const settings = normalizeDesktopStoredSettings({
      projectAppearances: {
        " project:one ": { color: "purple", icon: "plane" },
        "": { color: "red", icon: "flask" },
        "   ": { color: "blue", icon: "function" },
        "project:invalid-record": "purple",
      },
    })

    expect(settings.projectAppearances).toEqual({
      "project:one": { color: "purple", icon: "plane" },
    })
  })

  test("非法颜色和图标分别回退默认值，规范化项目 ID 后保留首项", () => {
    const settings = normalizeDesktopStoredSettings({
      projectAppearances: {
        " proje\u0301ct:cafe ": { color: "not-a-color", icon: "not-an-icon" },
        "projéct:cafe": { color: "green", icon: "flask" },
        "project:color-only": { color: "blue", icon: 123 },
        "project:icon-only": { color: null, icon: "terminal" },
      },
      recentWorkspaces: [{
        projectId: "project:color-only",
        path: "F:\\CodeProject\\ColorOnly",
        name: "ColorOnly",
        pinnedAt: "2026-07-25T01:00:00.000Z",
      }],
    })

    expect(settings.projectAppearances).toEqual({
      "projéct:cafe": DEFAULT_PROJECT_APPEARANCE,
      "project:color-only": { color: "blue", icon: "folder" },
      "project:icon-only": { color: "default", icon: "terminal" },
    })
    expect(settings.recentWorkspaces).toMatchObject([{
      projectId: "project:color-only",
      pinnedAt: "2026-07-25T01:00:00.000Z",
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
