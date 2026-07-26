import type { ModelRef, PermissionConfig, SubagentProfile, SubagentResult, TaskMode } from "../domain"
import type { WorkspaceService } from "../workspace/WorkspaceService"
import type { PromptBundle, PromptSection } from "../prompt/types"
import type { SkillService } from "../prompt/SkillService"
import type { ToolCatalog } from "../tool/ToolRegistry"
import type { ExecutionPlanInput } from "./plan/ExecutionPlanInput"
import type { RichQuestion } from "../session/QuestionInput"

export interface PlanCheckpoint {
  state: string
  interruption: unknown
  answer: string | null
  decision?: "allow" | "deny"
  toolCallID?: string
  approvalID?: string
  checkpointID?: string
  permissionGrant?: {
    scope: "tool-call" | "turn" | "session"
    grantedPermissions: {
      readPaths?: string[]
      writePaths?: string[]
      networkDomains?: string[]
    }
  }
}

export interface PendingApproval {
  checkpoint: Omit<PlanCheckpoint, "answer">
  kind: "clarification" | "subagents" | "permission"
  question?: string
  options?: string[]
  questions?: RichQuestion[]
  autoResolutionMs?: number
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

export interface ProjectSourceRuntimeAccess {
  list(): Promise<unknown>
  read(
    sourceID: string,
    range?: { offset: number; length: number },
  ): Promise<{
    source: {
      id: string
      name: string
      kind: "text" | "image"
    }
    data: Uint8Array
    mediaType: string
    range: {
      offset: number
      length: number
      total: number
    }
  }>
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
  defaultModeRequestUserInput?: boolean
  promptSections?: PromptSection[]
  skillService?: SkillService
  projectSources?: ProjectSourceRuntimeAccess
  allowedTools?: readonly string[]
  toolCatalog?: ToolCatalog
  onPromptComposed?: (bundle: PromptBundle, context: { budgetText: string }) => void | Promise<void>
  onUsage?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number; requests: number }) => void | Promise<void>
  onRuntimeReady?: () => void | Promise<void>
  resolveModel(fallback: ModelRef): Promise<{ ref: ModelRef; model: unknown }>
  pause(approval: PendingApproval): Promise<void>
  updatePlan?(input: ExecutionPlanInput, toolCallID: string): Promise<unknown>
  /** Subagent-only safe-boundary control; main Chat steer does not use this callback. */
  checkSafeBoundary?: () => Promise<boolean>
  attachments?: Array<{ kind: "text"; name: string; text: string } | { kind: "image"; name: string; mediaType: string; base64: string }>
}

export type AgentRuntimeResult =
  | { status: "completed"; output: string; result?: SubagentResult }
  | { status: "paused"; output: string }

export interface AgentRuntime {
  run(request: AgentRuntimeRequest): Promise<AgentRuntimeResult>
  steer(
    threadID: string,
    content: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    inputID?: string,
  ): Promise<void>
  followUp(threadID: string, content: string): Promise<void>
  abort(threadID: string): Promise<void>
  compact(threadID: string, instructions?: string): Promise<unknown>
  dispose(): Promise<void>
}

export function isMainAgentRequestUserInputEnabled(request: Pick<AgentRuntimeRequest, "taskMode" | "defaultModeRequestUserInput">) {
  return request.taskMode === "plan" || request.defaultModeRequestUserInput === true
}
