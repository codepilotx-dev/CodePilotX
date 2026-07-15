import type {
  ApprovalRequest,
  AgentExecution,
  Input,
  Item,
  Message,
  ThreadListItem,
  ThreadSnapshot,
  Turn,
} from "@codepilotx/shared/thread"
import type { EventEnvelope, Item as StoredItem } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import { SubagentRepository } from "../subagent/SubagentRepository"

const parse = <T>(value: string): T => JSON.parse(value) as T

const turnStatus = (status: string): Turn["status"] => {
  if (status === "waiting_permission") return "waiting-permission"
  if (status === "waiting_question") return "waiting-question"
  if (status === "waiting_plan_confirmation") return "waiting-plan-confirmation"
  if (status === "waiting_subagents") return "waiting-subagents"
  if (status === "interrupted") return "interrupted"
  if (status === "queued" || status === "running" || status === "completed" || status === "failed" || status === "cancelled") return status
  return "stopped"
}

const inputState = (status: string): Input["state"] => {
  if (status === "queued") return "queued"
  if (status === "mailbox" || status === "consumed") return "merged"
  if (status === "cancelled") return "cancelled"
  if (status === "completed") return "completed"
  return "active"
}

const asText = (value: unknown) => typeof value === "string" ? value : value == null ? null : JSON.stringify(value, null, 2)
const activityCommandStatus = (value: unknown): "success" | "running" | "error" | "interrupted" | undefined => value === "success" || value === "running" || value === "error" || value === "interrupted" ? value : undefined
const activityCommands = (value: unknown): Extract<Item, { type: "activity" }>["commands"] => {
  if (!Array.isArray(value)) return undefined
  const commands = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const item = entry as Record<string, unknown>
    if (typeof item.command !== "string" || typeof item.output !== "string") return []
    const status = activityCommandStatus(item.status)
    return [{
      command: item.command,
      output: item.output,
      ...(status ? { status } : {}),
      ...(typeof item.truncated === "boolean" ? { truncated: item.truncated } : {}),
    }]
  })
  return commands.length ? commands : undefined
}

export class ThreadProjection {
  private readonly subagents: SubagentRepository

  constructor(private readonly db: AgentDatabase) {
    this.subagents = new SubagentRepository(db)
  }

  snapshot(threadId: string): ThreadSnapshot | null {
    const thread = this.db.sqlite.query("SELECT id, title, project_id, task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at FROM threads WHERE id = ?").get(threadId) as
      | { id: string; title: string; project_id: string | null; task_mode: ThreadSnapshot["thread"]["settings"]["taskMode"]; sandbox_mode: ThreadSnapshot["thread"]["settings"]["permissionConfig"]["sandboxMode"]; approval_policy: ThreadSnapshot["thread"]["settings"]["permissionConfig"]["approvalPolicy"]; approvals_reviewer: ThreadSnapshot["thread"]["settings"]["permissionConfig"]["approvalsReviewer"]; created_at: number; updated_at: number }
      | null
    if (!thread) return null
    const inputs = (this.db.sqlite.query("SELECT id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at FROM inputs WHERE thread_id = ? ORDER BY created_at").all(threadId) as Array<Record<string, string | number | null>>).map((row): Input => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id ? String(row.turn_id) : null,
      content: String(row.content),
      strategy: String(row.strategy) as Input["strategy"],
      mode: String(row.task_mode) as Input["mode"],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Input["permissionConfig"]["sandboxMode"],
        approvalPolicy: String(row.approval_policy) as Input["permissionConfig"]["approvalPolicy"],
        approvalsReviewer: String(row.approvals_reviewer) as Input["permissionConfig"]["approvalsReviewer"],
      },
      state: inputState(String(row.status)),
      createdAt: Number(row.created_at),
    }))
    const turns = (this.db.sqlite.query("SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, started_at, finished_at, created_at FROM turns WHERE thread_id = ? ORDER BY created_at").all(threadId) as Array<Record<string, string | number | null>>).map((row): Turn => {
      const turnInputs = inputs.filter((input) => input.turnId === row.id)
      const startedAt = row.started_at == null ? null : Number(row.started_at)
      const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
      return {
        id: String(row.id),
        threadId: String(row.thread_id),
        sourceInputID: turnInputs[0]?.id ?? "",
        status: turnStatus(String(row.status)),
        mode: String(row.mode) as Turn["mode"],
        model: parse(String(row.model_ref)),
        permissionConfig: {
          sandboxMode: String(row.sandbox_mode) as Turn["permissionConfig"]["sandboxMode"],
          approvalPolicy: String(row.approval_policy) as Turn["permissionConfig"]["approvalPolicy"],
          approvalsReviewer: String(row.approvals_reviewer) as Turn["permissionConfig"]["approvalsReviewer"],
        },
        rootAgentId: String(row.root_agent_id),
        mergedInputIDs: turnInputs.slice(1).map((input) => input.id),
        canContinueFromPlan: String(row.status) === "waiting_plan_confirmation",
        startedAt,
        finishedAt,
        elapsedSeconds: startedAt == null ? 0 : Math.max(0, Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)),
        error: null,
      }
    })
    const agents = (this.db.sqlite.query("SELECT id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, subagent_run_id, run_sequence, status, error, created_at, updated_at FROM agent_executions WHERE thread_id = ? ORDER BY created_at").all(threadId) as Array<Record<string, string | number | null>>).map((row): AgentExecution => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      parentAgentId: row.parent_agent_id == null ? null : String(row.parent_agent_id),
      profile: String(row.profile),
      task: String(row.task),
      model: parse(String(row.model_ref)),
      sessionId: String(row.session_id),
      depth: Number(row.depth),
      subagentRunId: row.subagent_run_id == null ? null : String(row.subagent_run_id),
      runSequence: Number(row.run_sequence ?? 0),
      status: String(row.status).replaceAll("_", "-") as AgentExecution["status"],
      error: row.error == null ? null : String(row.error),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }))
    const messages = (this.db.sqlite.query("SELECT id, thread_id, turn_id, role, created_at FROM messages WHERE thread_id = ? ORDER BY ordinal, created_at, id").all(threadId) as Array<Record<string, string | number | null>>).map((row): Message => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id ? String(row.turn_id) : null,
      role: String(row.role) as Message["role"],
      createdAt: Number(row.created_at),
    }))
    const items = (this.db.sqlite.query("SELECT id, turn_id, agent_id, type, status, data, created_at, updated_at FROM items WHERE thread_id = ? ORDER BY created_at").all(threadId) as Array<Record<string, string | number | null>>)
      .map((row) => this.item({
        id: String(row.id),
        turnID: String(row.turn_id),
        agentID: String(row.agent_id),
        type: String(row.type) as StoredItem["type"],
        status: String(row.status) as StoredItem["status"],
        data: parse(String(row.data)),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      }))
      .filter((item): item is Item => item !== null)
    const approvals = (this.db.sqlite.query("SELECT id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, review_payload, created_at FROM approval_requests WHERE thread_id = ? ORDER BY created_at").all(threadId) as Array<Record<string, string | number | null>>).map((row) => this.approval(row))
    return {
      thread: {
        id: thread.id,
        title: thread.title,
        projectID: thread.project_id,
        settings: {
          taskMode: thread.task_mode,
          permissionConfig: {
            sandboxMode: thread.sandbox_mode,
            approvalPolicy: thread.approval_policy,
            approvalsReviewer: thread.approvals_reviewer,
          },
        },
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
      },
      turns,
      agents,
      subagents: this.subagents.projectionForThread(threadId),
      inputs,
      messages,
      items,
      approvals,
    }
  }

  list(params: { projectID?: string; archived?: boolean; limit?: number } = {}) {
    const where: string[] = ["t.kind = 'main'"]
    const values: Array<string | number | null> = []
    if (params.projectID !== undefined) {
      where.push("t.project_id = ?")
      values.push(params.projectID)
    }
    if (params.archived !== undefined) {
      where.push(params.archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL")
    }
    const sql = `
      SELECT t.id, t.project_id, t.title, t.preview, t.first_user_message, t.message_count,
        t.archived_at, t.task_mode, t.sandbox_mode, t.approval_policy, t.approvals_reviewer, t.created_at, t.updated_at,
        (SELECT status FROM turns AS u WHERE u.thread_id = t.id ORDER BY u.created_at DESC LIMIT 1) AS latest_turn_status
      FROM threads AS t
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ?
    `
    values.push(params.limit ?? 100)
    const rows = this.db.sqlite.query(sql).all(...values) as Array<Record<string, string | number | null>>
    return rows.map((row): ThreadListItem => ({
      id: String(row.id),
      projectID: row.project_id == null ? null : String(row.project_id),
      title: String(row.title),
      preview: row.preview == null ? null : String(row.preview),
      firstUserMessage: row.first_user_message == null ? null : String(row.first_user_message),
      messageCount: Number(row.message_count ?? 0),
      latestTurnStatus: row.latest_turn_status == null ? null : turnStatus(String(row.latest_turn_status)),
      archivedAt: row.archived_at == null ? null : Number(row.archived_at),
      settings: {
        taskMode: String(row.task_mode) as ThreadListItem["settings"]["taskMode"],
        permissionConfig: {
          sandboxMode: String(row.sandbox_mode) as ThreadListItem["settings"]["permissionConfig"]["sandboxMode"],
          approvalPolicy: String(row.approval_policy) as ThreadListItem["settings"]["permissionConfig"]["approvalPolicy"],
          approvalsReviewer: String(row.approvals_reviewer) as ThreadListItem["settings"]["permissionConfig"]["approvalsReviewer"],
        },
      },
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }))
  }

  item(item: StoredItem): Item | null {
    const messageID = item.turnID
    const agentId = item.agentID
    const status = item.status === "running" || item.status === "pending" ? "streaming" : item.status === "interrupted" ? "interrupted" : "completed"
    if (item.type === "reasoning") return { id: item.id, messageID, turnId: item.turnID, agentId, type: "reasoning", text: asText(item.data.text) ?? "", status, createdAt: item.createdAt }
    if (item.type === "text" || (item.type === "activity" && typeof item.data.text === "string")) return { id: item.id, messageID, turnId: item.turnID, agentId, type: "text", placement: item.data.placement === "process" ? "process" : "result", text: asText(item.data.text) ?? "", status, createdAt: item.createdAt }
    if (item.type === "activity") {
      const activity = ["context-compression", "file-edit", "build", "notice"].includes(String(item.data.activity)) ? item.data.activity as "context-compression" | "file-edit" | "build" | "notice" : "notice"
      const commands = activityCommands(item.data.commands)
      return { id: item.id, messageID, turnId: item.turnID, agentId, type: "activity", activity, title: asText(item.data.title) ?? "执行活动", ...(typeof item.data.detail === "string" ? { detail: item.data.detail } : {}), ...(commands ? { commands } : {}), status: item.status === "error" ? "error" : item.status === "interrupted" ? "interrupted" : item.status === "completed" ? "completed" : "running", createdAt: item.createdAt }
    }
    if (item.type === "tool") {
      const toolName = asText(item.data.toolName) ?? "tool"
      const input = item.data.input ?? item.data.inputText ?? null
      return { id: item.id, messageID, turnId: item.turnID, agentId, type: "tool", callID: item.id, tool: toolName, title: `运行了 ${toolName}`, state: item.status === "pending" ? "pending" : item.status === "running" ? "running" : item.status === "error" ? "error" : item.status === "interrupted" ? "interrupted" : "completed", input, command: null, output: asText(item.data.output), error: asText(item.data.error), startedAt: item.createdAt, finishedAt: item.status === "completed" || item.status === "error" ? item.updatedAt : null, durationMs: item.status === "completed" || item.status === "error" ? item.updatedAt - item.createdAt : null, createdAt: item.createdAt }
    }
    if (item.type === "plan") return { id: item.id, messageID, turnId: item.turnID, agentId, type: "plan", title: asText(item.data.title) ?? "实施计划", markdown: asText(item.data.markdown ?? item.data.text) ?? "", version: typeof item.data.version === "number" ? item.data.version : 1, state: ["draft", "awaiting-confirmation", "confirmed", "rejected"].includes(String(item.data.state)) ? String(item.data.state) as "draft" | "awaiting-confirmation" | "confirmed" | "rejected" : "awaiting-confirmation", createdAt: item.createdAt }
    if (item.type === "question") {
      const options = Array.isArray(item.data.options) ? item.data.options.filter((value): value is string => typeof value === "string") : []
      return { id: item.id, messageID, turnId: item.turnID, agentId, type: "question", prompt: asText(item.data.question) ?? "需要你的选择", choices: options.map((label, index) => ({ id: String(index), label, recommended: index === 0 })), status: item.status === "pending" ? "pending" : item.status === "interrupted" ? "cancelled" : "answered", answer: asText(item.data.answer), createdAt: item.createdAt }
    }
    if (item.type === "patch") return { id: item.id, messageID, turnId: item.turnID, agentId, type: "patch", files: Array.isArray(item.data.files) ? item.data.files as Extract<Item, { type: "patch" }>["files"] : [], totalAdditions: Number(item.data.totalAdditions ?? item.data.additions ?? 0), totalDeletions: Number(item.data.totalDeletions ?? item.data.deletions ?? 0), createdAt: item.createdAt }
    if (item.type === "subagent") {
      const rawStatus = String(item.data.status).replaceAll("_", "-")
      const subagentStatus = ["queued", "preparing", "running", "steering", "waiting-question", "waiting-permission", "completed", "failed", "stopped", "interrupted"].includes(rawStatus)
        ? rawStatus as Extract<Item, { type: "subagent" }>["status"]
        : "interrupted"
      const rawQueueReason = item.data.queueReason == null ? null : String(item.data.queueReason).replaceAll("_", "-")
      const queueReason = rawQueueReason === "parent-limit" || rawQueueReason === "global-limit" || rawQueueReason === "workspace-writer" ? rawQueueReason : null
      return {
        id: item.id, messageID, turnId: item.turnID, agentId, type: "subagent",
        subagentTaskId: String(item.data.subagentTaskId), runId: String(item.data.runId), childThreadId: String(item.data.childThreadId),
        displayName: String(item.data.displayName), profile: String(item.data.profile) as Extract<Item, { type: "subagent" }>["profile"],
        task: String(item.data.task), status: subagentStatus, queueReason,
        result: item.data.result && typeof item.data.result === "object" ? item.data.result as Extract<Item, { type: "subagent" }>["result"] : null,
        createdAt: item.createdAt,
      }
    }
    return null
  }

  approval(row: Record<string, string | number | null>): ApprovalRequest {
    const tool = this.db.sqlite.query("SELECT tool_name, input FROM tool_calls WHERE id = ?").get(String(row.tool_call_id)) as { tool_name: string; input: string } | null
    const input = tool ? parse<Record<string, unknown>>(tool.input) : {}
    const paths = [input.path, input.cwd].filter((value): value is string => typeof value === "string")
    const command = typeof input.command === "string" ? input.command : null
    const request = typeof row.request_payload === "string" ? parse<Record<string, unknown>>(row.request_payload) : {}
    const rawPermissions = request.requestedPermissions
    const permissions = rawPermissions && typeof rawPermissions === "object" && !Array.isArray(rawPermissions) ? rawPermissions as Record<string, unknown> : {}
    const list = (name: string) => Array.isArray(permissions[name]) ? permissions[name].filter((value): value is string => typeof value === "string") : []
    const review = typeof row.review_payload === "string" ? parse<ApprovalRequest["review"]>(row.review_payload) : null
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      agentId: String(row.agent_id),
      toolCallID: String(row.tool_call_id),
      tool: tool?.tool_name ?? "tool",
      command,
      cwd: typeof input.cwd === "string" ? input.cwd : null,
      paths,
      requestedPermissions: {
        readPaths: list("readPaths"),
        writePaths: list("writePaths"),
        networkDomains: list("networkDomains"),
      },
      review,
      risk: String(row.risk) as ApprovalRequest["risk"],
      reason: String(row.reason),
      status: row.status === "pending" ? "pending" : row.status === "cancelled" ? "cancelled" : row.reply === "allow" ? "allowed" : "denied",
      createdAt: Number(row.created_at),
    }
  }

  notification(event: EventEnvelope) {
    const source = event.params && typeof event.params === "object"
      ? event.params as Record<string, unknown>
      : {}
    const storedItem = source.item && typeof source.item === "object"
      ? source.item as Partial<StoredItem>
      : null
    const item = storedItem
      && typeof storedItem.id === "string"
      && typeof storedItem.turnID === "string"
      && typeof storedItem.agentID === "string"
      && typeof storedItem.type === "string"
      && typeof storedItem.status === "string"
      && storedItem.data
      && typeof storedItem.data === "object"
      && typeof storedItem.createdAt === "number"
      && typeof storedItem.updatedAt === "number"
      ? this.item(storedItem as StoredItem)
      : source.item
    const params = {
      ...source,
      ...(event.threadId === null ? {} : { threadId: event.threadId }),
      ...(event.turnId === null ? {} : { turnId: event.turnId }),
      ...(item === undefined ? {} : { item }),
    }
    return {
      id: event.id,
      threadId: event.threadId,
      notification: {
        jsonrpc: "2.0" as const,
        method: event.method as never,
        params,
      },
      createdAt: event.createdAt,
    }
  }

}
