import { describe, expect, test } from "bun:test"
import type { DesktopSessionSnapshot } from "../shared/types"
import { defaultDesktopStoredSettings } from "../shared/settingsSchema"
import { projectPetNotifications } from "../src/features/pet/petNotificationProjector"

function snapshot(
  id: string,
  status: DesktopSessionSnapshot["item"]["status"],
  pendingPermissions: DesktopSessionSnapshot["view"]["pendingPermissions"] = [],
): DesktopSessionSnapshot {
  return {
    item: {
      id,
      workspaceName: "workspace",
      workspacePath: "C:\\workspace",
      permissionMode: "default",
      model: null,
      thinkingMode: "default",
      hasSystemPrompt: false,
      hasAppendSystemPrompt: false,
      additionalDirectoryCount: 0,
      status,
      createdAt: "2026-07-24T00:00:00.000Z",
    },
    workspace: { name: "workspace", path: "C:\\workspace" },
    settings: {
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
      thinkingMode: "default",
      additionalDirectories: [],
    },
    view: { messages: [], toolLog: [], pendingPermissions, contextUsage: null },
    updatedAt: "2026-07-24T00:00:10.000Z",
  }
}

describe("pet notification projector", () => {
  const preferences = defaultDesktopStoredSettings().pet

  test("prioritizes questions and keeps stable blocker IDs", () => {
    const notifications = projectPetNotifications({
      previous: [],
      current: [
        snapshot("thread-1", "waiting", [
          {
            requestId: "question-1",
            toolName: "AskUserQuestion",
            input: {},
            description: "请选择一个选项",
          },
          {
            requestId: "approval-1",
            toolName: "PowerShell",
            input: {},
            description: "运行命令",
            requestKind: "shell-command",
          },
        ]),
      ],
      now: Date.parse("2026-07-24T00:00:20.000Z"),
      dismissedIds: new Set(),
      preferences,
    })
    expect(notifications.map(item => [item.id, item.kind])).toEqual([
      ["thread-1:question-1", "question"],
      ["thread-1:approval-1", "exec"],
    ])
  })

  test("emits transition notifications and respects dismissal", () => {
    const now = Date.parse("2026-07-24T00:00:20.000Z")
    const completed = projectPetNotifications({
      previous: [snapshot("thread-1", "running")],
      current: [snapshot("thread-1", "done")],
      now,
      dismissedIds: new Set(),
      preferences,
    })
    expect(completed[0]?.kind).toBe("completed")
    expect(
      projectPetNotifications({
        previous: [snapshot("thread-1", "running")],
        current: [snapshot("thread-1", "done")],
        now,
        dismissedIds: new Set([completed[0]!.id]),
        preferences,
      }),
    ).toEqual([])
  })
})
