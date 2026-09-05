import { describe, expect, test } from "bun:test"
import type { Automation, AutomationRun } from "@codepilotx/shared/automation"
import type { ModelRef } from "@codepilotx/shared/model"
import { AutomationRunCoordinator } from "../src/automation/AutomationRunCoordinator"
import type { AutomationRepository } from "../src/storage/repositories/automation-repository"

const automation = {
  id: "automation:1", revision: 1, kind: "thread", name: "检查", prompt: "执行检查", status: "active",
  projectId: null, targetThreadId: "thread:1", execution: null,
  model: { providerID: "openai", id: "codex" } as ModelRef, reasoningEffort: null,
  permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", approvalsReviewer: "user" },
  schedule: { mode: "daily", time: "09:00" }, canonicalRrule: "FREQ=DAILY", timeZone: "Asia/Shanghai",
  notificationPolicy: "all", nextRunAt: null, pendingCatchUp: false, activeRunId: "run:1",
  createdAt: 1, updatedAt: 1, deletedAt: null,
} satisfies Automation

const claimed = {
  id: "run:1", automationId: automation.id, trigger: "manual", scheduledFor: 1, status: "claimed",
  threadId: null, turnId: null, worktreeId: null, readAt: null, safeErrorCode: null,
  createdAt: 1, startedAt: null, completedAt: null,
} satisfies AutomationRun

describe("AutomationRunCoordinator", () => {
  test("Turn 在绑定前已终态时由 durable 状态补偿完成 run", async () => {
    const terminal: AutomationRun["status"][] = []
    const repository = {
      read: () => automation,
      readRun: () => null,
      markPreparing: () => ({ ...claimed, status: "preparing" }),
      bindExecution: () => ({ ...claimed, status: "queued", threadId: "thread:1", turnId: "turn:1", startedAt: 2 }),
      completeRun: (_runId: string, status: AutomationRun["status"]) => {
        terminal.push(status)
        return { run: { ...claimed, status, threadId: "thread:1", turnId: "turn:1", completedAt: 3 }, catchUpRun: null }
      },
    } as unknown as AutomationRepository
    const coordinator = new AutomationRunCoordinator(
      repository,
      { start: async () => ({ threadId: "thread:1", turnId: "turn:1" }) },
      { getTurnStatus: () => "completed", now: () => 2 },
    )
    await coordinator.startRun(claimed)
    expect(terminal).toEqual(["completed"])
  })
})
