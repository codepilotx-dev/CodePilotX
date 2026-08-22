import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { TaskboardStartExecution, TaskboardStartOperation } from "@codepilotx/agent-protocol/taskboard"
import type { TaskboardWorkflowStartMode } from "@codepilotx/shared/taskboard"
import { AgentError, type EventEnvelope } from "../domain"
import type { ThreadService } from "../session/ThreadService"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { EventHub } from "../storage/events/EventHub"
import type { TaskboardRepository } from "../storage/repositories/taskboard-repository"
import type { ManagedWorktreeService } from "../worktree/ManagedWorktreeService"
import type { ThreadExecutionPreparationService } from "../worktree/ThreadExecutionPreparationService"
import { taskboardExecutionInstruction } from "./TaskboardService"

const requestHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")

export class TaskboardStartService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly repository: TaskboardRepository,
    private readonly threads: ThreadService,
    private readonly worktrees: ManagedWorktreeService,
    private readonly threadExecutions: ThreadExecutionPreparationService,
    private readonly now: () => number = Date.now,
  ) {}

  async start(input: { taskId: string; execution: TaskboardStartExecution; operationId: string }, requestIdentity?: unknown) {
    const task = this.requireTask(input.taskId)
    this.requireProject(task.task.projectId)
    const active = this.repository.activeTaskboardStartOperation(input.taskId)
    if (active && active.operationId !== input.operationId) {
      return active.status === "awaiting_setup_decision" ? active : this.continueStart(active)
    }
    const existing = this.repository.getTaskboardStartOperation(input.operationId)
    if (existing) {
      const validated = this.repository.createTaskboardStartOperation({
        operationId: input.operationId,
        taskId: input.taskId,
        projectId: task.task.projectId,
        requestHash: requestHash(requestIdentity ?? { taskId: input.taskId, execution: input.execution }),
        execution: input.execution,
      })
      if (validated.status !== "running") return validated
      return this.continueStart(validated)
    }

    const created = this.db.transaction(() => {
      const operation = this.repository.createTaskboardStartOperation({
        operationId: input.operationId,
        taskId: input.taskId,
        projectId: task.task.projectId,
        requestHash: requestHash(requestIdentity ?? { taskId: input.taskId, execution: input.execution }),
        execution: input.execution,
      })
      const event = this.repository.insertTaskboardChanged({ projectId: task.task.projectId, taskId: input.taskId, resource: "start", action: "created" })
      return { operation, event }
    })
    await this.publish(created.event)
    return this.continueStart(created.operation)
  }

  async startWorkflow(input: { taskId: string; execution: TaskboardStartExecution; operationId: string; expectedVersion: number; mode: TaskboardWorkflowStartMode; authorizeBacklog?: boolean }) {
    const workflowRequest = {
      taskId: input.taskId,
      execution: input.execution,
      expectedVersion: input.expectedVersion,
      mode: input.mode,
      authorizeBacklog: input.authorizeBacklog ?? false,
    }
    if (this.repository.getTaskboardStartOperation(input.operationId) || this.repository.activeTaskboardStartOperation(input.taskId)) {
      return this.start({ taskId: input.taskId, execution: input.execution, operationId: input.operationId }, workflowRequest)
    }
    const prepared = this.db.transaction(() => {
      const timestamp = this.now()
      const task = this.repository.prepareWorkflowStart({
        taskId: input.taskId,
        expectedVersion: input.expectedVersion,
        mode: input.mode,
        ...(input.authorizeBacklog === undefined ? {} : { authorizeBacklog: input.authorizeBacklog }),
        updatedAt: timestamp,
      })
      return {
        task,
        legacyEvent: this.repository.insertTaskboardChanged({ projectId: task.task.projectId, taskId: input.taskId, resource: "start", action: "updated", changedAt: timestamp }),
        workflowEvent: this.repository.insertTaskboardWorkflowChanged({ projectId: task.task.projectId, taskId: input.taskId, resource: input.mode === "new_primary" ? "thread" : "workflow", action: "updated", changedAt: timestamp }),
      }
    })
    await this.publish(prepared.legacyEvent)
    await this.publish(prepared.workflowEvent)
    return this.start({ taskId: input.taskId, execution: input.execution, operationId: input.operationId }, workflowRequest)
  }

  status(input: { operationId: string; afterRevision?: number }) {
    const operation = this.requireOperation(input.operationId)
    return { operation, changed: input.afterRevision === undefined || operation.revision > input.afterRevision }
  }

  async retrySetup(input: { operationId: string; revision: number }) {
    const operation = this.requireAwaiting(input.operationId, input.revision)
    const worktreeId = operation.worktreeId
    if (!worktreeId) throw new AgentError("WORKTREE_NOT_FOUND", "任务启动没有可恢复的 worktree", 404)
    const result = await this.worktrees.retrySetup({ worktreeId, operationId: `${operation.operationId}:retry-setup:${operation.revision}` })
    if (result.worktree.status === "ready-with-setup-error" && !result.worktree.continuedWithoutSetup) {
      return this.update(operation, { status: "awaiting_setup_decision", errorCode: "WORKTREE_SETUP_REQUIRED", warnings: result.operation.warnings })
    }
    const running = await this.update(operation, { status: "running", errorCode: null, warnings: result.operation.warnings })
    return this.continueStart(running)
  }

  async continueWithoutSetup(input: { operationId: string; revision: number }) {
    const operation = this.requireAwaiting(input.operationId, input.revision)
    const worktreeId = operation.worktreeId
    if (!worktreeId) throw new AgentError("WORKTREE_NOT_FOUND", "任务启动没有可恢复的 worktree", 404)
    const result = this.worktrees.continueWithoutSetup({ worktreeId, operationId: `${operation.operationId}:continue-setup:${operation.revision}` })
    const running = await this.update(operation, { status: "running", errorCode: null, warnings: result.operation.warnings })
    return this.continueStart(running)
  }

  private async continueStart(operation: TaskboardStartOperation): Promise<TaskboardStartOperation> {
    const task = this.requireTask(operation.taskId)
    this.requireProject(task.task.projectId)
    const primary = task.threads.find((link) => link.role === "primary")
    if (primary) return this.completeExisting(operation, primary.threadId, primary.execution.kind === "worktree" ? primary.execution.worktreeId : null, task.task.number)

    let worktreeId = operation.worktreeId
    let createdWorktree = operation.execution.kind === "new_worktree" && worktreeId !== null
    try {
      if (operation.execution.kind === "new_worktree" && !worktreeId) {
        const startingState = operation.execution.startingState
        operation = await this.update(operation, { step: "prepare_worktree" })
        const result = await this.worktrees.create({
          projectId: operation.projectId,
          operationId: `${operation.operationId}:worktree:create`,
          startingState: startingState.type === "working_tree"
            ? { type: "working-tree" }
            : startingState,
        })
        createdWorktree = true
        worktreeId = result.worktree.id
        operation = await this.update(operation, { worktreeId, warnings: result.operation.warnings })
        if (result.worktree.status === "ready-with-setup-error" && !result.worktree.continuedWithoutSetup) {
          return this.update(operation, { status: "awaiting_setup_decision", errorCode: "WORKTREE_SETUP_REQUIRED" })
        }
      } else if (operation.execution.kind === "existing_worktree") {
        worktreeId = operation.execution.worktreeId
      }

      operation = await this.update(operation, { step: "create_thread", ...(worktreeId ? { worktreeId } : {}) })
      const execution = worktreeId ? { kind: "worktree" as const, worktreeId } : { kind: "local" as const }
      const prepared = await this.threadExecutions.prepare(operation.projectId, execution)
      let completionEvent: EventEnvelope | null = null
      const startupInstruction = this.startupInstruction(
        operation.projectId,
        task.task.number,
        task.task.title,
      )
      let created
      try {
        created = await this.threads.create({
          title: `#${task.task.number} ${task.task.title}`,
          operationID: `${operation.operationId}:thread:create`,
          workspace: { kind: "project", projectID: operation.projectId },
          bindExecution: (threadId) => {
            // Worktree preparation can outlive a user action. Revalidate at the
            // atomic thread/link boundary so an archived task or removed
            // project never acquires a new execution conversation.
            this.requireTask(operation.taskId)
            this.requireProject(operation.projectId)
            prepared.bind(threadId)
            this.repository.linkPrimaryThread({ taskId: operation.taskId, threadId, linkedAt: this.now() })
            this.repository.recordActivity({ taskId: operation.taskId, kind: "execution_started", actor: "user", data: { threadId }, createdAt: this.now() })
            operation = this.repository.updateTaskboardStartOperation({
              operationId: operation.operationId,
              expectedRevision: operation.revision,
              patch: { threadId, worktreeId: worktreeId ?? null, status: "completed", step: "complete", startupInstruction, completedAt: this.now() },
            })
            completionEvent = this.repository.insertTaskboardChanged({ projectId: operation.projectId, taskId: operation.taskId, resource: "start", action: "updated" })
          },
        })
      } catch (cause) {
        await prepared.abort()
        throw cause
      }
      await prepared.reconcile(created.id)
      if (completionEvent) await this.publish(completionEvent)
      else {
        const latest = this.requireOperation(operation.operationId)
        if (latest.status !== "completed") {
          const repaired = this.db.transaction(() => {
            const current = this.requireTask(latest.taskId)
            const link = this.repository.taskLinkForThread(created.id)
            if (link && link.taskId !== latest.taskId) throw new AgentError("TASKBOARD_THREAD_ALREADY_LINKED", "该对话已关联其他任务", 409)
            if (!link) this.repository.linkPrimaryThread({ taskId: latest.taskId, threadId: created.id, linkedAt: this.now() })
            else if (link.role !== "primary") this.repository.setPrimaryThread({ taskId: latest.taskId, threadId: created.id, expectedVersion: current.task.version, updatedAt: this.now() })
            this.repository.recordActivity({ taskId: latest.taskId, kind: "execution_started", actor: "system", data: { threadId: created.id, recovered: true }, createdAt: this.now() })
            const value = this.repository.updateTaskboardStartOperation({
              operationId: latest.operationId,
              expectedRevision: latest.revision,
              patch: { threadId: created.id, worktreeId: worktreeId ?? null, status: "completed", step: "complete", startupInstruction, completedAt: this.now() },
            })
            const event = this.repository.insertTaskboardChanged({ projectId: value.projectId, taskId: value.taskId, resource: "start", action: "updated" })
            return { value, event }
          })
          await this.publish(repaired.event)
          operation = repaired.value
        }
      }
      return this.requireOperation(operation.operationId)
    } catch (cause) {
      if (createdWorktree && worktreeId) {
        try {
          await this.worktrees.delete({ worktreeId, operationId: `${operation.operationId}:worktree:rollback` })
        } catch {
          return this.update(this.requireOperation(operation.operationId), { status: "rollback_failed", errorCode: "ROLLBACK_FAILED", warnings: ["新建 worktree 清理失败，请在 worktree 管理页检查"] , completedAt: this.now() })
        }
      }
      const code = cause instanceof AgentError ? cause.code : "INTERNAL_ERROR"
      await this.update(this.requireOperation(operation.operationId), { status: "failed", errorCode: code, completedAt: this.now() })
      throw cause
    }
  }

  private async completeExisting(operation: TaskboardStartOperation, threadId: string, worktreeId: string | null, number: number) {
    if (operation.status === "completed") return operation
    return this.update(operation, {
      threadId,
      worktreeId,
      status: "completed",
      step: "complete",
      startupInstruction: this.startupInstruction(
        operation.projectId,
        number,
        this.requireTask(operation.taskId).task.title,
      ),
      completedAt: this.now(),
    })
  }

  private async update(operation: TaskboardStartOperation, patch: Parameters<TaskboardRepository["updateTaskboardStartOperation"]>[0]["patch"]) {
    const committed = this.db.transaction(() => {
      const value = this.repository.updateTaskboardStartOperation({ operationId: operation.operationId, expectedRevision: operation.revision, patch })
      const event = this.repository.insertTaskboardChanged({ projectId: value.projectId, taskId: value.taskId, resource: "start", action: "updated" })
      return { value, event }
    })
    await this.publish(committed.event)
    return committed.value
  }

  private requireTask(taskId: string) {
    const task = this.repository.readTask(taskId)
    if (!task) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "任务不存在", 404)
    if (task.task.archivedAt !== null) throw new AgentError("CONFLICT", "已归档任务不能开始执行", 409)
    return task
  }
  private requireProject(projectId: string) { if (!this.db.getProject(projectId)) throw new AgentError("PROJECT_REMOVED", "项目已被移除，任务只能只读访问", 409) }
  private requireOperation(operationId: string) { const operation = this.repository.getTaskboardStartOperation(operationId); if (!operation) throw new AgentError("TASKBOARD_START_OPERATION_NOT_FOUND", "任务启动操作不存在", 404); return operation }
  private requireAwaiting(operationId: string, revision: number) { const operation = this.requireOperation(operationId); if (operation.revision !== revision || operation.status !== "awaiting_setup_decision") throw new AgentError("CONFLICT", "任务启动状态已变化", 409); return operation }
  private startupInstruction(projectId: string, number: number, title: string) {
    const projectName = this.db.getProject(projectId)?.name ?? "项目"
    return taskboardExecutionInstruction(projectName, number, title)
  }
  private publish(event: EventEnvelope) { return Effect.runPromise(this.hub.publish(event)).then(() => undefined) }
}
