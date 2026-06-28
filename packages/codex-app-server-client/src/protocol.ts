/**
 * Subset of the OpenAI Codex `app-server` v2 JSON-RPC protocol that the
 * CodePilotX desktop app needs. Types are hand-written and intentionally
 * permissive (most fields are `unknown` or `Record<string, unknown>`) so the
 * desktop app can call methods the runtime doesn't strictly need to
 * validate.
 *
 * When the protocol stabilizes, regenerate this file with
 * `codex app-server generate-ts --out <generated>`.
 */

export type JsonRpcId = number | string

export type JsonRpcRequest<P = unknown> = {
  id: JsonRpcId
  method: string
  params?: P
}

export type JsonRpcResponse<R = unknown> = {
  id: JsonRpcId
  result?: R
  error?: JsonRpcError
}

export type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcNotification<P = unknown> = {
  method: string
  params?: P
}

export type JsonRpcMessage =
  | { kind: 'request'; request: JsonRpcRequest }
  | { kind: 'response'; response: JsonRpcResponse }
  | { kind: 'notification'; notification: JsonRpcNotification }
  | { kind: 'parse-error'; raw: string; error: string }

// ---- Initialize handshake ----

export type ClientInfo = {
  name: string
  title: string
  version: string
}

export type InitializeParams = {
  clientInfo: ClientInfo
  capabilities?: {
    experimentalApi?: boolean
    mcpServerOpenaiFormElicitation?: boolean
    optOutNotificationMethods?: string[]
  }
}

export type InitializeResult = {
  userAgent: string
  codexHome: string
  platformFamily?: string
  platformOs?: string
}

// ---- Thread lifecycle ----

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type SandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess: boolean }
  | {
      type: 'workspaceWrite'
      writableRoots: string[]
      networkAccess: boolean
      excludeTmpdirEnvVar: boolean
      excludeSlashTmp: boolean
    }

export type ThreadStartParams = {
  model?: string
  modelProvider?: string
  baseInstructions?: string
  developerInstructions?: string
  cwd?: string
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted'
  approvalsReviewer?: 'user' | 'auto_review'
  sandbox?: SandboxMode
  config?: Record<string, unknown>
  personality?: 'friendly' | 'pragmatic' | 'none'
  ephemeral?: boolean
  sessionStartSource?: 'startup' | 'clear' | 'resume'
  threadSource?: string
  experimentalMultiAgentMode?: 'explicitRequestOnly' | 'proactive'
  serviceName?: string
  serviceTier?: string | null
  /** Identifies this client in OpenAI compliance logs. */
}

export type Thread = {
  id: string
  preview: string
  modelProvider: string
  createdAt: number
  ephemeral?: boolean
  path?: string | null
  sessionId?: string
  forkedFromId?: string | null
  turns?: Turn[]
  status?: ThreadStatus
}

export type ThreadStatus =
  | { type: 'notLoaded' }
  | { type: 'idle' }
  | { type: 'active'; activeFlags: string[] }
  | { type: 'systemError'; error: string }

export type ThreadStartResult = {
  thread: Thread
}

export type ThreadListParams = {
  cursor?: string | null
  limit?: number | null
  archived?: boolean | null
  cwd?: string | string[] | null
  useStateDbOnly?: boolean
  searchTerm?: string | null
}

export type ThreadListResponse = {
  data: Thread[]
  nextCursor: string | null
  backwardsCursor?: string | null
}

export type ThreadReadParams = {
  threadId: string
  includeTurns?: boolean
}

export type ThreadReadResponse = {
  thread: Thread
}

export type ThreadForkParams = ThreadStartParams & {
  threadId: string
}

export type ThreadArchiveResponse = Record<string, never>

export type ThreadUnarchiveResponse = {
  thread: Thread
}

// ---- Turn lifecycle ----

export type UserInputText = {
  type: 'text'
  text: string
}

export type UserInputImageLocal = {
  type: 'local_image'
  path: string
}

export type UserInput = UserInputText | UserInputImageLocal

export type TurnStartParams = {
  threadId: string
  input: UserInput[]
  cwd?: string
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh'
  summary?: 'auto' | 'concise' | 'detailed' | 'none'
  clientUserMessageId?: string
  /** Override settings for this turn. */
  approvalPolicy?: ThreadStartParams['approvalPolicy']
  approvalsReviewer?: ThreadStartParams['approvalsReviewer']
  sandboxPolicy?: SandboxPolicy
  permissions?: { profileId: string }
  experimentalMultiAgentMode?: ThreadStartParams['experimentalMultiAgentMode']
  serviceTier?: string | null
  personality?: ThreadStartParams['personality']
}

export type Turn = {
  id: string
  status: 'inProgress' | 'completed' | 'interrupted' | 'failed'
  items: Item[]
  error?: { message: string }
}

export type TurnStartResult = {
  turn: Turn
}

export type TurnInterruptParams = {
  threadId: string
  turnId: string
}

// ---- Goals / plan / collaboration ----

export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type ThreadGoal = {
  threadId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export type ThreadGoalGetParams = {
  threadId: string
}

export type ThreadGoalGetResponse = {
  goal: ThreadGoal | null
}

export type ThreadGoalSetParams = {
  threadId: string
  objective?: string | null
  status?: ThreadGoalStatus | null
  tokenBudget?: number | null
}

export type ThreadGoalSetResponse = {
  goal: ThreadGoal
}

export type ThreadGoalClearParams = {
  threadId: string
}

export type TurnPlanStep = {
  step: string
  status: 'pending' | 'inProgress' | 'completed'
}

export type TurnPlanUpdatedNotification = {
  method: 'turn/plan/updated'
  params: {
    threadId: string
    turnId: string
    explanation: string | null
    plan: TurnPlanStep[]
  }
}

export type PlanDeltaNotification = {
  method: 'item/plan/delta'
  params: {
    threadId: string
    turnId: string
    itemId: string
    delta: string
  }
}

export type CollaborationModePreset = {
  name: string
  mode: 'plan' | 'default' | null
  model: string | null
  reasoning_effort: 'low' | 'medium' | 'high' | 'xhigh' | null
}

export type CollaborationModeListResponse = {
  data: CollaborationModePreset[]
}

// ---- Background terminals ----

export type ThreadBackgroundTerminal = {
  itemId: string
  processId: string
  command: string
  cwd: string
  osPid: number | null
  cpuPercent: number | null
  rssKb: number | null
}

export type ThreadBackgroundTerminalsListParams = {
  threadId: string
  cursor?: string | null
  limit?: number | null
}

export type ThreadBackgroundTerminalsListResponse = {
  data: ThreadBackgroundTerminal[]
  nextCursor: string | null
}

export type ThreadBackgroundTerminalsTerminateParams = {
  threadId: string
  processId: string
}

export type ThreadBackgroundTerminalsTerminateResponse = {
  terminated: boolean
}

export type ThreadBackgroundTerminalsCleanParams = {
  threadId: string
}

// ---- Hooks ----

export type HookTrustStatus = 'trusted' | 'unknown' | 'modified' | 'untrusted'

export type HookMetadata = {
  key: string
  eventName: string
  handlerType: string
  matcher: string | null
  command: string | null
  timeoutSec: number | string
  statusMessage: string | null
  sourcePath: string
  source: string
  pluginId: string | null
  displayOrder: number | string
  enabled: boolean
  isManaged: boolean
  currentHash: string
  trustStatus: HookTrustStatus
}

export type HookErrorInfo = {
  path: string
  message: string
}

export type HooksListEntry = {
  cwd: string
  hooks: HookMetadata[]
  warnings: string[]
  errors: HookErrorInfo[]
}

export type HooksListResponse = {
  data: HooksListEntry[]
}

// ---- Files / search ----

export type FsReadDirectoryParams = {
  path: string
}

export type FsReadDirectoryEntry = {
  fileName: string
  isDirectory: boolean
  isFile: boolean
}

export type FsReadDirectoryResponse = {
  entries: FsReadDirectoryEntry[]
}

export type FsReadFileParams = {
  path: string
}

export type FsReadFileResponse = {
  dataBase64: string
}

export type FuzzyFileSearchParams = {
  query: string
  roots: string[]
  cancellationToken?: string | null
}

export type FuzzyFileSearchResult = {
  root: string
  path: string
  match_type: 'file' | 'directory'
  file_name: string
  score: number
  indices: number[] | null
}

export type FuzzyFileSearchResponse = {
  files: FuzzyFileSearchResult[]
}

// ---- Memory / guardian ----

export type ThreadMemoryModeSetParams = {
  threadId: string
  enabled: boolean
}

export type ThreadApproveGuardianDeniedActionParams = {
  threadId: string
  event: unknown
}

export type GuardianApprovalReview = {
  status: string
  riskLevel: string | null
  userAuthorization: string | null
  rationale: string | null
}

// ---- Items ----

export type Item =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileEditItem
  | PatchItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | ErrorItem
  | UserMessageItem
  | EnterPlanModeItem
  | ExitPlanModeItem

export type AgentMessageItem = {
  type: 'agentMessage'
  id: string
  text: string
}

export type ReasoningItem = {
  type: 'reasoning'
  id: string
  summary?: string | string[]
  content?: string | string[]
}

export type CommandExecutionItem = {
  type: 'commandExecution'
  id: string
  command: string
  aggregatedOutput?: string
  exitCode?: number | null
  status: 'inProgress' | 'completed' | 'failed' | 'declined'
  durationMs?: number
}

export type FileEditItem = {
  type: 'fileEdit' | 'fileChange'
  id: string
  path?: string
  diff?: string
  changes?: unknown
  status: 'inProgress' | 'completed' | 'failed' | 'declined'
}

export type PatchItem = {
  type: 'patch'
  id: string
  changes: unknown
  status: 'inProgress' | 'completed' | 'failed' | 'declined'
}

export type McpToolCallItem = {
  type: 'mcpToolCall'
  id: string
  server: string
  tool: string
  arguments: Record<string, unknown>
  result?: { content: unknown; structuredContent?: unknown }
  status: 'inProgress' | 'completed' | 'failed'
  error?: { message: string }
}

export type WebSearchItem = {
  type: 'webSearch'
  id: string
  query: string
}

export type TodoListItem = {
  type: 'todoList'
  id: string
  items: Array<{ text: string; completed?: boolean; status?: string }>
}

export type ErrorItem = {
  type: 'error'
  id: string
  message: string
}

export type UserMessageItem = {
  type: 'userMessage'
  id: string
  content: UserInput[]
  clientId?: string
}

export type EnterPlanModeItem = {
  type: 'enterPlanMode'
  id: string
}

export type ExitPlanModeItem = {
  type: 'exitPlanMode'
  id: string
  plan: string
}

// ---- Notifications (server -> client) ----

export type ThreadStartedNotification = {
  method: 'thread/started'
  params: { thread: Thread }
}

export type ThreadStatusChangedNotification = {
  method: 'thread/status/changed'
  params: { threadId: string; status: ThreadStatus }
}

export type ThreadArchivedNotification = {
  method: 'thread/archived'
  params: { thread: Thread }
}

export type TurnStartedNotification = {
  method: 'turn/started'
  params: { threadId: string; turn: Turn }
}

export type TurnCompletedNotification = {
  method: 'turn/completed'
  params: { threadId: string; turn: Turn }
}

export type ItemStartedNotification = {
  method: 'item/started'
  params: { threadId: string; turnId: string; item: Item }
}

export type ItemCompletedNotification = {
  method: 'item/completed'
  params: { threadId: string; turnId: string; item: Item }
}

export type AgentMessageDeltaNotification = {
  method: 'item/agentMessage/delta'
  params: { threadId: string; turnId: string; itemId: string; delta: string }
}

export type CommandExecutionOutputDeltaNotification = {
  method: 'item/commandExecution/outputDelta'
  params: {
    threadId: string
    turnId: string
    itemId: string
    delta: string
  }
}

export type ReasoningSummaryDeltaNotification = {
  method: 'item/reasoning/summaryTextDelta'
  params: {
    threadId: string
    turnId: string
    itemId: string
    delta: string
    summaryIndex?: number
  }
}

export type ReasoningContentDeltaNotification = {
  method: 'item/reasoning/textDelta'
  params: {
    threadId: string
    turnId: string
    itemId: string
    delta: string
    contentIndex?: number
  }
}

export type ReasoningSummaryPartAddedNotification = {
  method: 'item/reasoning/summaryPartAdded'
  params: { threadId: string; turnId: string; itemId: string; text?: string }
}

export type TokenUsageSnapshot = {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  totalTokens?: number
}

export type ThreadTokenUsage = {
  total?: TokenUsageSnapshot
  last?: TokenUsageSnapshot
  modelContextWindow?: number
}

export type TokenUsageUpdatedNotification = {
  method: 'thread/tokenUsage/updated'
  params: {
    threadId: string
    turnId?: string
    tokenUsage: ThreadTokenUsage
  }
}

export type ThreadGoalUpdatedNotification = {
  method: 'thread/goal/updated'
  params: {
    threadId: string
    turnId: string | null
    goal: ThreadGoal
  }
}

export type ThreadGoalClearedNotification = {
  method: 'thread/goal/cleared'
  params: { threadId: string }
}

export type ThreadSettingsUpdatedNotification = {
  method: 'thread/settings/updated'
  params: { threadId: string; settings: unknown }
}

export type HookStartedNotification = {
  method: 'hook/started'
  params: Record<string, unknown>
}

export type HookCompletedNotification = {
  method: 'hook/completed'
  params: Record<string, unknown>
}

export type FsChangedNotification = {
  method: 'fs/changed'
  params: Record<string, unknown>
}

export type GuardianApprovalReviewStartedNotification = {
  method: 'item/autoApprovalReview/started'
  params: {
    threadId: string
    turnId: string
    itemId: string
    review: GuardianApprovalReview
  }
}

export type GuardianApprovalReviewCompletedNotification = {
  method: 'item/autoApprovalReview/completed'
  params: {
    threadId: string
    turnId: string
    itemId: string
    review: GuardianApprovalReview
  }
}

export type ThreadRealtimeNotification = {
  method:
    | 'thread/realtime/started'
    | 'thread/realtime/sdp'
    | 'thread/realtime/itemAdded'
    | 'thread/realtime/outputAudioDelta'
    | 'thread/realtime/transcriptDelta'
    | 'thread/realtime/transcriptDone'
    | 'thread/realtime/closed'
    | 'thread/realtime/error'
  params: Record<string, unknown>
}

export type ErrorNotification = {
  method: 'error'
  params: { threadId?: string; turnId?: string; message: string; fatal?: boolean }
}

export type AppServerNotification =
  | ThreadStartedNotification
  | ThreadStatusChangedNotification
  | ThreadArchivedNotification
  | TurnStartedNotification
  | TurnCompletedNotification
  | ItemStartedNotification
  | ItemCompletedNotification
  | AgentMessageDeltaNotification
  | CommandExecutionOutputDeltaNotification
  | ReasoningSummaryDeltaNotification
  | ReasoningContentDeltaNotification
  | ReasoningSummaryPartAddedNotification
  | TokenUsageUpdatedNotification
  | ThreadGoalUpdatedNotification
  | ThreadGoalClearedNotification
  | TurnPlanUpdatedNotification
  | PlanDeltaNotification
  | ThreadSettingsUpdatedNotification
  | HookStartedNotification
  | HookCompletedNotification
  | FsChangedNotification
  | GuardianApprovalReviewStartedNotification
  | GuardianApprovalReviewCompletedNotification
  | ThreadRealtimeNotification
  | ErrorNotification

// ---- Configuration RPC ----

export type ConfigEdit = {
  keyPath: string
  value: unknown
  mergeStrategy: 'replace' | 'upsert'
}

export type ConfigBatchWriteParams = {
  edits: ConfigEdit[]
  /** When true, hot-reload loaded threads. Defaults to false. */
  reloadUserConfig?: boolean
}

// ---- Model / provider ----

export type ModelInfo = {
  id: string
  displayName?: string
  description?: string
  supportedReasoningEfforts?: string[]
  defaultReasoningEffort?: string
  hidden?: boolean
  isDefault?: boolean
}

export type ListModelsParams = {
  includeHidden?: boolean
}

export type ListModelsResult = {
  data: ModelInfo[]
  nextCursor?: string | null
}

// ---- MCP ----

export type ListMcpServersParams = {
  threadId?: string
  cursor?: string
  limit?: number
  detail?: 'minimal' | 'full'
}

export type McpServerStatus = {
  name: string
  transport: unknown
  authStatus: 'unsupported' | 'oauth-not-started' | 'oauth-in-progress' | 'authenticated' | 'failed'
  tools: Array<{ name: string; description?: string }>
  resources?: unknown[]
  resourceTemplates?: unknown[]
  enabled: boolean
}

// ---- Server request params / approval response ----

export type CommandExecutionRequestApprovalParams = {
  threadId: string
  turnId: string
  itemId: string
  startedAtMs?: number
  approvalId?: string | null
  environmentId?: string | null
  command?: string | null
  cwd?: string
  reason?: string
  networkApprovalContext?: unknown
  commandActions?: unknown
  additionalPermissions?: unknown
  proposedExecpolicyAmendment?: unknown
  proposedNetworkPolicyAmendments?: unknown
  availableDecisions?: string[] | null
}

export type FileChangeRequestApprovalParams = {
  threadId: string
  turnId: string
  itemId: string
  startedAtMs?: number
  reason?: string
  grantRoot?: string
}

export type ToolRequestUserInputParams = {
  threadId: string
  turnId: string
  itemId: string
  questions: Array<{
    id?: string
    header: string
    question: string
    isOther?: boolean
    isSecret?: boolean
    options: Array<{ label: string; description?: string }>
  }>
  autoResolutionMs?: number
}

export type PermissionsRequestApprovalParams = {
  threadId: string
  turnId: string
  itemId: string
  environmentId?: string | null
  startedAtMs?: number
  cwd?: string
  permissions: unknown
  reason?: string
}

export type CommandExecutionRequestApprovalResponse = {
  decision:
    | 'accept'
    | 'acceptForSession'
    | 'decline'
    | 'cancel'
    | 'always'
    | 'never'
}

export type FileChangeRequestApprovalResponse = {
  decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel'
}

export type PermissionsRequestApprovalResponse = {
  permissions: unknown
  scope: 'turn' | 'session'
  strictAutoReview?: boolean
}

export type SendUserInputAnswersParams = {
  threadId: string
  turnId: string
  itemId: string
  answers: Record<string, { answers: string[] }>
}

export type ToolRequestUserInputResponse = {
  answers: Record<string, { answers: string[] }>
}
