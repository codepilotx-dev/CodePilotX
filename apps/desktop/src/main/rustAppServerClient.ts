import type {
  RustLineJsonRpcClient,
  JsonRpcId,
} from './rustLineJsonRpcClient.js'
import type {
  InitializeParams,
  InitializeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
  ThreadDeleteParams,
  ThreadDeleteResponse,
  ThreadSetNameParams,
  ThreadSetNameResponse,
  ThreadSettingsUpdateParams,
  ThreadSettingsUpdateResponse,
  TurnSteerParams,
  TurnSteerResponse,
  ThreadCompactStartParams,
  ThreadCompactStartResponse,
  ThreadRollbackParams,
  ThreadRollbackResponse,
  ThreadGoalSetParams,
  ThreadGoalSetResponse,
  ThreadGoalGetParams,
  ThreadGoalGetResponse,
  ThreadGoalClearParams,
  ThreadGoalClearResponse,
  ReviewStartParams,
  ReviewStartResponse,
  ModelListParams,
  ModelListResponse,
  ModelProviderCapabilitiesReadParams,
  ModelProviderCapabilitiesReadResponse,
  PermissionProfileListParams,
  PermissionProfileListResponse,
  SkillsListParams,
  SkillsListResponse,
  SkillsConfigWriteParams,
  SkillsConfigWriteResponse,
  HooksListParams,
  HooksListResponse,
  ConfigBatchWriteParams,
  ConfigWriteResponse,
} from './rustAppServerProtocol/index.js'
import { desktopDebug } from './desktopDebug.js'

export type ThreadForkParams = {
  threadId: string
  model?: string | null
  modelProvider?: string | null
  cwd?: string | null
  ephemeral?: boolean | null
}

export type ThreadForkResponse = {
  thread: {
    id: string
  }
  model?: string
  modelProvider?: string
}

/**
 * Typed JSON-RPC client for the Rust app-server protocol.
 *
 * Supports:
 * - Standard methods: initialize, initialized, thread/start, turn/start, turn/interrupt
 * - All server notifications via onAnyNotification
 * - Server-initiated requests (tool calls, permission approvals, command/file approvals)
 * - Control response forwarding
 */
export class RustAppServerClient {
  constructor(private readonly transport: RustLineJsonRpcClient) {}

  // ── Standard request/notification methods ─────────────────────────

  async initialize(params: InitializeParams): Promise<InitializeResponse> {
    return this.transport.sendRequest(
      'initialize',
      params,
    ) as Promise<InitializeResponse>
  }

  notifyInitialized(): void {
    this.transport.sendNotification('initialized')
  }

  async startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return this.transport.sendRequest(
      'thread/start',
      params,
    ) as Promise<ThreadStartResponse>
  }

  async startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.transport.sendRequest(
      'turn/start',
      params,
    ) as Promise<TurnStartResponse>
  }

  async forkThread(params: ThreadForkParams): Promise<ThreadForkResponse> {
    return this.transport.sendRequest(
      'thread/fork',
      params,
    ) as Promise<ThreadForkResponse>
  }

  async resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return this.transport.sendRequest(
      'thread/resume',
      params,
    ) as Promise<ThreadResumeResponse>
  }

  async listThreads(params: ThreadListParams = {}): Promise<ThreadListResponse> {
    return this.transport.sendRequest(
      'thread/list',
      params,
    ) as Promise<ThreadListResponse>
  }

  async readThread(params: ThreadReadParams): Promise<ThreadReadResponse> {
    return this.transport.sendRequest(
      'thread/read',
      params,
    ) as Promise<ThreadReadResponse>
  }

  async archiveThread(params: ThreadArchiveParams): Promise<ThreadArchiveResponse> {
    return this.transport.sendRequest(
      'thread/archive',
      params,
    ) as Promise<ThreadArchiveResponse>
  }

  async unarchiveThread(
    params: ThreadUnarchiveParams,
  ): Promise<ThreadUnarchiveResponse> {
    return this.transport.sendRequest(
      'thread/unarchive',
      params,
    ) as Promise<ThreadUnarchiveResponse>
  }

  async deleteThread(params: ThreadDeleteParams): Promise<ThreadDeleteResponse> {
    return this.transport.sendRequest(
      'thread/delete',
      params,
    ) as Promise<ThreadDeleteResponse>
  }

  async setThreadName(params: ThreadSetNameParams): Promise<ThreadSetNameResponse> {
    return this.transport.sendRequest(
      'thread/name/set',
      params,
    ) as Promise<ThreadSetNameResponse>
  }

  async updateThreadSettings(
    params: ThreadSettingsUpdateParams,
  ): Promise<ThreadSettingsUpdateResponse> {
    return this.transport.sendRequest(
      'thread/settings/update',
      params,
    ) as Promise<ThreadSettingsUpdateResponse>
  }

  async interruptTurn(
    params: TurnInterruptParams,
  ): Promise<TurnInterruptResponse> {
    return this.transport.sendRequest(
      'turn/interrupt',
      params,
    ) as Promise<TurnInterruptResponse>
  }

  async steerTurn(params: TurnSteerParams): Promise<TurnSteerResponse> {
    return this.transport.sendRequest(
      'turn/steer',
      params,
    ) as Promise<TurnSteerResponse>
  }

  async compactThread(
    params: ThreadCompactStartParams,
  ): Promise<ThreadCompactStartResponse> {
    return this.transport.sendRequest(
      'thread/compact/start',
      params,
    ) as Promise<ThreadCompactStartResponse>
  }

  async rollbackThread(
    params: ThreadRollbackParams,
  ): Promise<ThreadRollbackResponse> {
    return this.transport.sendRequest(
      'thread/rollback',
      params,
    ) as Promise<ThreadRollbackResponse>
  }

  async setThreadGoal(
    params: ThreadGoalSetParams,
  ): Promise<ThreadGoalSetResponse> {
    return this.transport.sendRequest(
      'thread/goal/set',
      params,
    ) as Promise<ThreadGoalSetResponse>
  }

  async getThreadGoal(
    params: ThreadGoalGetParams,
  ): Promise<ThreadGoalGetResponse> {
    return this.transport.sendRequest(
      'thread/goal/get',
      params,
    ) as Promise<ThreadGoalGetResponse>
  }

  async clearThreadGoal(
    params: ThreadGoalClearParams,
  ): Promise<ThreadGoalClearResponse> {
    return this.transport.sendRequest(
      'thread/goal/clear',
      params,
    ) as Promise<ThreadGoalClearResponse>
  }

  async startReview(params: ReviewStartParams): Promise<ReviewStartResponse> {
    return this.transport.sendRequest(
      'review/start',
      params,
    ) as Promise<ReviewStartResponse>
  }

  async listModels(params: ModelListParams = {}): Promise<ModelListResponse> {
    return this.transport.sendRequest(
      'model/list',
      params,
    ) as Promise<ModelListResponse>
  }

  async readModelProviderCapabilities(
    params: ModelProviderCapabilitiesReadParams = {},
  ): Promise<ModelProviderCapabilitiesReadResponse> {
    return this.transport.sendRequest(
      'modelProvider/capabilities/read',
      params,
    ) as Promise<ModelProviderCapabilitiesReadResponse>
  }

  async listPermissionProfiles(
    params: PermissionProfileListParams = {},
  ): Promise<PermissionProfileListResponse> {
    return this.transport.sendRequest(
      'permissionProfile/list',
      params,
    ) as Promise<PermissionProfileListResponse>
  }

  async listSkills(params: SkillsListParams = {}): Promise<SkillsListResponse> {
    return this.transport.sendRequest(
      'skills/list',
      params,
    ) as Promise<SkillsListResponse>
  }

  async writeSkillConfig(
    params: SkillsConfigWriteParams,
  ): Promise<SkillsConfigWriteResponse> {
    return this.transport.sendRequest(
      'skills/config/write',
      params,
    ) as Promise<SkillsConfigWriteResponse>
  }

  async listHooks(params: HooksListParams = {}): Promise<HooksListResponse> {
    return this.transport.sendRequest(
      'hooks/list',
      params,
    ) as Promise<HooksListResponse>
  }

  async batchWriteConfig(
    params: ConfigBatchWriteParams,
  ): Promise<ConfigWriteResponse> {
    return this.transport.sendRequest(
      'config/batchWrite',
      params,
    ) as Promise<ConfigWriteResponse>
  }

  /**
   * Tell the app-server to re-read MCP server config from disk.
   * Silently ignored if the server version doesn't support it.
   */
  async reloadMcpConfig(): Promise<Record<string, never>> {
    return this.transport.sendRequest(
      'config/mcpServer/reload',
      undefined,
    ) as Promise<Record<string, never>>
  }

  // ── All-notification listener (wildcard) ──────────────────────────

  /**
   * Register a listener for ALL server notifications, regardless of method.
   * Replaces the previous hard-coded per-method subscription approach.
   * Existing per-method subscriptions are still supported via onNotification().
   */
  onServerNotification(
    listener: (method: string, params: unknown) => void,
  ): () => void {
    return this.transport.onAnyNotification(listener)
  }

  /** Register a listener for a specific notification method. */
  onNotification(
    method: string,
    listener: (params: unknown) => void,
  ): () => void {
    return this.transport.onNotification(method, listener)
  }

  // ── Server-initiated request handlers ─────────────────────────────

  /**
   * Register a handler for a server-initiated JSON-RPC request.
   * The handler receives (params, requestId) and must return the result
   * (which is sent back as the JSON-RPC response).
   *
   * Known server request methods:
   * - item/tool/call              — Dynamic tool call needing client execution
   * - item/permissions/requestApproval  — Permission approval request
   * - item/commandExecution/requestApproval — Shell command approval
   * - item/fileChange/requestApproval   — File change approval
   */
  onServerRequest(
    method: string,
    handler: (params: unknown, id: JsonRpcId) => Promise<unknown>,
  ): () => void {
    return this.transport.onRequest(method, handler)
  }

  /**
   * Send a response to a server-initiated request.
   * Used when the runtime has resolved a permission/tool decision and
   * needs to respond to a pending server request.
   */
  sendControlResponse(requestId: JsonRpcId, result: unknown): void {
    this.transport.sendResponse(requestId, result)
  }

  // ── Tool result notification ──────────────────────────────────────

  /**
   * Notify the server that a tool has completed execution with a result.
   * The server uses this to continue the turn with the tool output.
   */
  notifyToolResult(params: {
    toolUseId: string
    result: unknown
    isError?: boolean
  }): void {
    this.transport.sendNotification('item/tool/result', params)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  close(): void {
    this.transport.close()
  }
}
