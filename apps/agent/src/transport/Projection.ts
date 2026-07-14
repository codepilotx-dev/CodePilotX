import type {
  EventEnvelope as SharedEnvelope,
  Input,
  Message,
  Part,
  PermissionRequest,
  ProviderInfo as SharedProviderInfo,
  Run,
  SessionSnapshot as SharedSnapshot,
} from "@codepilotx/shared"
import type { EventEnvelope, ProviderInfo, SessionPart } from "../domain"
import type { AgentDatabase } from "../storage/Database"

const parse = <T>(value: string): T => JSON.parse(value) as T
const runStatus = (status: string): Run["status"] => {
  if (status === "waiting_permission") return "waiting-permission"
  if (status === "waiting_question") return "waiting-question"
  if (status === "waiting_plan_confirmation") return "waiting-plan-confirmation"
  if (status === "interrupted") return "interrupted"
  if (status === "queued" || status === "running" || status === "completed" || status === "failed") return status
  return "stopped"
}

const inputState = (status: string): Input["state"] => {
  if (status === "queued") return "queued"
  if (status === "mailbox" || status === "consumed") return "merged"
  if (status === "cancelled") return "cancelled"
  if (status === "completed") return "completed"
  return "active"
}

type ActivityCommandStatus = NonNullable<NonNullable<Extract<Part, { type: "activity" }>["commands"]>[number]["status"]>

const asText = (value: unknown) => typeof value === "string" ? value : value == null ? null : JSON.stringify(value, null, 2)
const activityCommandStatus = (value: unknown): ActivityCommandStatus | undefined => {
  if (value === "success" || value === "running" || value === "error" || value === "interrupted") return value
  return undefined
}
const activityCommands = (value: unknown): Extract<Part, { type: "activity" }>["commands"] => {
  if (!Array.isArray(value)) return undefined
  const commands = value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const command = (item as Record<string, unknown>).command
    const output = (item as Record<string, unknown>).output
    const status = (item as Record<string, unknown>).status
    const truncated = (item as Record<string, unknown>).truncated
    if (typeof command !== "string" || typeof output !== "string") return []
    const commandStatus = activityCommandStatus(status)
    return [{
      command,
      output,
      ...(commandStatus ? { status: commandStatus } : {}),
      ...(typeof truncated === "boolean" ? { truncated } : {}),
    }]
  })
  return commands.length ? commands : undefined
}

export class Projection {
  constructor(private readonly db: AgentDatabase) {}

  snapshot(sessionID: string): SharedSnapshot | null {
    const session = this.db.sqlite.query("SELECT id, title, project_id, created_at, updated_at FROM sessions WHERE id = ?").get(sessionID) as { id: string; title: string; project_id: string | null; created_at: number; updated_at: number } | null
    if (!session) return null
    const inputRows = this.db.sqlite.query("SELECT id, session_id, run_id, content, model_ref, permission_mode, strategy, task_mode, status, created_at FROM inputs WHERE session_id = ? ORDER BY created_at").all(sessionID) as Array<Record<string, string | number | null>>
    const inputs: Input[] = inputRows.map((row) => ({
      id: String(row.id), sessionID: String(row.session_id), runID: row.run_id ? String(row.run_id) : null,
      content: String(row.content), strategy: String(row.strategy) as Input["strategy"], mode: String(row.task_mode) as Input["mode"],
      model: parse(String(row.model_ref)), permissionMode: String(row.permission_mode) as Input["permissionMode"], state: inputState(String(row.status)), createdAt: Number(row.created_at),
    }))
    const runRows = this.db.sqlite.query("SELECT id, session_id, status, mode, permission_mode, model_ref, current_stage, can_continue_from_plan, started_at, finished_at, created_at FROM runs WHERE session_id = ? ORDER BY created_at").all(sessionID) as Array<Record<string, string | number | null>>
    const runs: Run[] = runRows.map((row) => {
      const runInputs = inputs.filter((input) => input.runID === row.id)
      const startedAt = row.started_at == null ? null : Number(row.started_at)
      const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
      return {
        id: String(row.id), sessionID: String(row.session_id), sourceInputID: runInputs[0]?.id ?? "", status: runStatus(String(row.status)), mode: String(row.mode) as Run["mode"],
        model: parse(String(row.model_ref)), permissionMode: String(row.permission_mode) as Run["permissionMode"], mergedInputIDs: runInputs.slice(1).map((input) => input.id),
        currentStage: row.current_stage == null ? null : String(row.current_stage) as Run["currentStage"],
        canContinueFromPlan: Number(row.can_continue_from_plan ?? 0) === 1,
        stages: this.db.listRunStages(String(row.id)).map((stage) => ({ ...stage, status: stage.status.replace("_", "-") as Run["stages"][number]["status"] })),
        startedAt, finishedAt, elapsedSeconds: startedAt == null ? 0 : Math.max(0, Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)), error: null,
      }
    })
    const messages = (this.db.sqlite.query("SELECT id, session_id, run_id, role, created_at FROM messages WHERE session_id = ? ORDER BY created_at").all(sessionID) as Array<Record<string, string | number | null>>).map((row): Message => ({
      id: String(row.id), sessionID: String(row.session_id), runID: row.run_id ? String(row.run_id) : null, role: String(row.role) as Message["role"], createdAt: Number(row.created_at),
    }))
    const rawParts = this.db.sqlite.query("SELECT id, run_id, type, status, data, created_at, updated_at FROM parts WHERE session_id = ? ORDER BY created_at").all(sessionID) as Array<Record<string, string | number | null>>
    const parts = rawParts.map((row) => this.part({
      id: String(row.id), runID: String(row.run_id), type: String(row.type) as SessionPart["type"], status: String(row.status) as SessionPart["status"], data: parse(String(row.data)), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    })).filter((part): part is Part => part !== null)
    const permissions = (this.db.sqlite.query("SELECT id, session_id, run_id, tool_call_id, risk, reason, status, reply, created_at FROM permission_requests WHERE session_id = ? ORDER BY created_at").all(sessionID) as Array<Record<string, string | number | null>>).map((row) => this.permission(row))
    const proposals = runs.flatMap((run) => this.db.listProposals(run.id))
    return { session: { id: session.id, title: session.title, projectID: session.project_id, createdAt: session.created_at, updatedAt: session.updated_at }, runs, inputs, messages, parts, permissions, proposals }
  }

  part(part: SessionPart): Part | null {
    const messageID = part.runID
    const status = part.status === "running" || part.status === "pending" ? "streaming" : part.status === "interrupted" ? "interrupted" : "completed"
    if (part.type === "reasoning") return { id: part.id, messageID, runID: part.runID, type: "reasoning", text: asText(part.data.text) ?? "", status, createdAt: part.createdAt }
    if (part.type === "text" || (part.type === "activity" && typeof part.data.text === "string")) return { id: part.id, messageID, runID: part.runID, type: "text", placement: part.type === "text" ? "result" : "process", text: asText(part.data.text) ?? "", status, createdAt: part.createdAt }
    if (part.type === "activity") {
      const activity = ["context-compression", "file-edit", "build", "notice"].includes(String(part.data.activity)) ? part.data.activity as "context-compression" | "file-edit" | "build" | "notice" : "notice"
      const commands = activityCommands(part.data.commands)
      return { id: part.id, messageID, runID: part.runID, type: "activity", activity, title: asText(part.data.title) ?? "执行活动", ...(typeof part.data.detail === "string" ? { detail: part.data.detail } : {}), ...(commands ? { commands } : {}), status: part.status === "error" ? "error" : part.status === "interrupted" ? "interrupted" : part.status === "completed" ? "completed" : "running", createdAt: part.createdAt }
    }
    if (part.type === "tool") {
      const toolName = asText(part.data.toolName) ?? "tool"
      const input = part.data.input ?? part.data.inputText ?? null
      const command = toolName === "powershell.exec" && input && typeof input === "object" && typeof (input as Record<string, unknown>).command === "string" ? String((input as Record<string, unknown>).command) : null
      return { id: part.id, messageID, runID: part.runID, type: "tool", callID: part.id, tool: toolName, title: toolName === "powershell.exec" ? "运行了 PowerShell 命令" : `运行了 ${toolName}`, state: part.status === "pending" ? "pending" : part.status === "running" ? "running" : part.status === "error" ? "error" : part.status === "interrupted" ? "interrupted" : "completed", input, command, output: asText(part.data.output), error: asText(part.data.error), startedAt: part.createdAt, finishedAt: part.status === "completed" || part.status === "error" ? part.updatedAt : null, durationMs: part.status === "completed" || part.status === "error" ? part.updatedAt - part.createdAt : null, createdAt: part.createdAt }
    }
    if (part.type === "plan") return { id: part.id, messageID, runID: part.runID, type: "plan", title: asText(part.data.title) ?? "实施计划", markdown: asText(part.data.markdown ?? part.data.text) ?? "", version: typeof part.data.version === "number" ? part.data.version : 1, state: ["draft", "awaiting-confirmation", "confirmed", "rejected"].includes(String(part.data.state)) ? String(part.data.state) as "draft" | "awaiting-confirmation" | "confirmed" | "rejected" : "awaiting-confirmation", createdAt: part.createdAt }
    if (part.type === "question") {
      const options = Array.isArray(part.data.options) ? part.data.options : Array.isArray(part.data.choices) ? part.data.choices : []
      const questionStatus = part.status === "pending" ? "pending" : part.data.ignored === true ? "ignored" : part.status === "interrupted" ? "cancelled" : "answered"
      return { id: part.id, messageID, runID: part.runID, type: "question", prompt: asText(part.data.question) ?? "需要你的选择", choices: options.map((option, index) => typeof option === "string" ? { id: String(index + 1), label: option, recommended: index === 0 } : { id: typeof option === "object" && option && typeof (option as Record<string, unknown>).id === "string" ? String((option as Record<string, unknown>).id) : String(index + 1), label: typeof option === "object" && option && typeof (option as Record<string, unknown>).label === "string" ? String((option as Record<string, unknown>).label) : asText(option) ?? String(index + 1), ...(typeof option === "object" && option && typeof (option as Record<string, unknown>).description === "string" ? { description: String((option as Record<string, unknown>).description) } : {}), recommended: typeof option === "object" && option && typeof (option as Record<string, unknown>).recommended === "boolean" ? Boolean((option as Record<string, unknown>).recommended) : index === 0 }), status: questionStatus, answer: asText(part.data.answer), createdAt: part.createdAt }
    }
    if (part.type === "patch") {
      const files = Array.isArray(part.data.files) ? part.data.files.filter((file): file is { path: string; additions?: number; deletions?: number } => Boolean(file && typeof file === "object" && typeof (file as Record<string, unknown>).path === "string")) : []
      return { id: part.id, messageID, runID: part.runID, type: "patch", files: files.map((file) => ({ path: file.path, additions: file.additions ?? 0, deletions: file.deletions ?? 0 })), totalAdditions: Number(part.data.additions ?? 0), totalDeletions: Number(part.data.deletions ?? 0), createdAt: part.createdAt }
    }
    return null
  }

  permission(row: Record<string, string | number | null>): PermissionRequest {
    const tool = this.db.sqlite.query("SELECT tool_name, input FROM tool_calls WHERE id = ?").get(String(row.tool_call_id)) as { tool_name: string; input: string } | null
    const input = tool ? parse<Record<string, unknown>>(tool.input) : {}
    const paths = [input.path, input.cwd].filter((value): value is string => typeof value === "string")
    const command = typeof input.command === "string" ? input.command : null
    return { id: String(row.id), sessionID: String(row.session_id), runID: String(row.run_id), toolCallID: String(row.tool_call_id), tool: tool?.tool_name ?? "tool", command, paths, risk: String(row.risk) as PermissionRequest["risk"], reason: String(row.reason), status: row.status === "pending" ? "pending" : row.status === "cancelled" ? "cancelled" : row.reply === "allow" ? "allowed" : "denied", createdAt: Number(row.created_at) }
  }

  event(envelope: EventEnvelope): SharedEnvelope | null {
    if (!envelope.sessionID) return null
    const snapshot = this.snapshot(envelope.sessionID)
    if (!snapshot) return null
    const payload = envelope.payload && typeof envelope.payload === "object" ? envelope.payload as Record<string, unknown> : {}
    const runID = typeof payload.runID === "string" ? payload.runID : null
    if (envelope.type === "part.updated" && payload.id) {
      const part = snapshot.parts.find((item) => item.id === payload.id)
      if (part) return { id: envelope.id, sessionID: envelope.sessionID, runID: part.runID, event: { type: "part.upserted", part }, createdAt: envelope.createdAt }
    }
    if (envelope.type.startsWith("permission.")) {
      const permission = snapshot.permissions.find((item) => item.id === payload.id) ?? snapshot.permissions.at(-1)
      if (permission) return { id: envelope.id, sessionID: envelope.sessionID, runID: permission.runID, event: { type: "permission.updated", permission }, createdAt: envelope.createdAt }
    }
    if (envelope.type.startsWith("question.")) {
      const question = snapshot.parts.filter((part) => part.type === "question").find((part) => part.id === payload.id) ?? snapshot.parts.filter((part) => part.type === "question").at(-1)
      if (question?.type === "question") return { id: envelope.id, sessionID: envelope.sessionID, runID: question.runID, event: { type: "question.updated", question }, createdAt: envelope.createdAt }
    }
    if (runID) {
      const run = snapshot.runs.find((item) => item.id === runID)
      if (run) return { id: envelope.id, sessionID: envelope.sessionID, runID, event: { type: "run.updated", run }, createdAt: envelope.createdAt }
    }
    return { id: envelope.id, sessionID: envelope.sessionID, runID: null, event: { type: "session.snapshot", snapshot }, createdAt: envelope.createdAt }
  }

  providers(providers: ProviderInfo[]): SharedProviderInfo[] {
    return providers.map((provider) => ({ id: provider.id, name: provider.name, kind: provider.protocol, configured: provider.configured, ...(provider.baseURL ? { baseURL: provider.baseURL } : {}), models: provider.models.map((model) => ({ id: model.modelID, name: model.name, api: model.protocol === "openai" ? "openai-responses" : model.protocol === "anthropic" ? "anthropic-messages" : "openai-chat-completions", limits: { context: model.capabilities.inputLimit, output: model.capabilities.outputLimit }, capabilities: { reasoning: model.capabilities.reasoning, toolCall: model.capabilities.tools, imageInput: model.capabilities.image }, ...(model.defaults ? { defaultParameters: model.defaults } : {}) })) }))
  }
}
