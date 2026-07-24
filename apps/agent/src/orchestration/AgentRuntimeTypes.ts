import type { ModelRef, PermissionConfig, SubagentProfile, SubagentResult, TaskMode } from "../domain"
import type { WorkspaceService } from "../workspace/WorkspaceService"
import type { PromptBundle, PromptSection } from "../prompt/types"
import type { SkillService } from "../prompt/SkillService"

export interface PlanCheckpoint {
  state: string
  interruption: unknown
  answer: string | null
  decision?: "allow" | "deny"
  toolCallID?: string
  approvalID?: string
  checkpointID?: string
}

export interface PendingApproval {
  checkpoint: Omit<PlanCheckpoint, "answer">
  kind: "clarification" | "subagents" | "permission"
  question?: string
  options?: string[]
  runIDs?: string[]
  waitMode?: "all" | "any"
  toolCallID?: string
}

export interface DelegationController {
  spawn(input: { agents: Array<{ name?: string; profile: "default" | "explorer" | "worker"; task: string; workspaceMode?: "shared" | "worktree"; model?: ModelRef }> }): Promise<unknown>
  wait(input: { runIDs: string[]; mode: "all" | "any" }): Promise<unknown>
  isWaitSatisfied(input: { runIDs: string[]; mode: "all" | "any" }): Promise<boolean>
  send(input: { taskID: string; message: string }): Promise<unknown>
  stop(input: { taskID: string }): Promise<unknown>
}

export interface AgentRuntimeRequest {
  threadID: string
  turnID: string
  agentID: string
  sessionID: string
  profile?: SubagentProfile
  depth?: number
  delegation?: DelegationController
  content: string
  taskMode: TaskMode
  fallbackModel: ModelRef
  permissionConfig: PermissionConfig
  signal: AbortSignal
  workspace: WorkspaceService
  defaultCwd?: string
  resume?: PlanCheckpoint
  continueFromPlan?: boolean
  plan?: string
  defaultModeRequestUserInput?: boolean
  promptSections?: PromptSection[]
  skillService?: SkillService
  allowedTools?: readonly string[]
  onPromptComposed?: (bundle: PromptBundle, context: { budgetText: string }) => void | Promise<void>
  onUsage?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number; requests: number }) => void | Promise<void>
  resolveModel(fallback: ModelRef): Promise<{ ref: ModelRef; model: unknown }>
  pause(approval: PendingApproval): Promise<void>
  checkSafeBoundary?: () => Promise<boolean>
  attachments?: Array<{ kind: "text"; name: string; text: string } | { kind: "image"; name: string; mediaType: string; base64: string }>
}

export type AgentRuntimeResult =
  | { status: "completed"; output: string; result?: SubagentResult }
  | { status: "paused"; output: string }
  | { status: "plan-ready"; output: string; plan: string }

export interface AgentRuntime {
  run(request: AgentRuntimeRequest): Promise<AgentRuntimeResult>
  steer(threadID: string, content: string): Promise<void>
  followUp(threadID: string, content: string): Promise<void>
  abort(threadID: string): Promise<void>
  compact(threadID: string, instructions?: string): Promise<unknown>
  dispose(): Promise<void>
}

export function isMainAgentRequestUserInputEnabled(request: Pick<AgentRuntimeRequest, "taskMode" | "continueFromPlan" | "defaultModeRequestUserInput">) {
  return (request.taskMode === "plan" && !request.continueFromPlan) || request.defaultModeRequestUserInput === true
}
