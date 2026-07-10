/**
 * SidecarDesktopAgentRuntime —— 通过 JSON-RPC stdio sidecar 实现的 DesktopAgentRuntime。
 *
 * 旧版 v1 sidecar 运行时，已被 RustSidecarDesktopAgentRuntime 替代。
 * 该文件仅保留以备历史引用，不再在运行时创建路径中使用。
 */

import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { ThreadEvent } from '@codepilotx/core/agent/workflow.js'
import type {
  DesktopPermissionRequest,
  DesktopUserMessageContent,
} from '../shared/types.js'
import type {
  DesktopAgentRuntime,
  DesktopAgentRuntimeContext,
} from './agentRuntime.js'
import {
  SidecarManager,
  buildSidecarEnv,
  SidecarStartError,
  type SidecarManagerOptions,
  type SidecarPermissionContext,
  type SidecarPermissionDecision,
} from './sidecarManager.js'
import { desktopDebug } from './desktopDebug.js'
import { buildDesktopContextUsage } from './desktopContextUsage.js'

type TurnCompletedEvent = Extract<ThreadEvent, { type: 'turn.completed' }>

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// TUI entrypoints/appServer.ts 的相对路径
const SIDECAR_ENTRYPOINT = join(
  __dirname, '..', '..', '..', '..', '..',
  'apps', 'tui', 'src', 'entrypoints', 'appServer.ts',
)

export class SidecarDesktopAgentRuntime implements DesktopAgentRuntime {
  private sidecarManager: SidecarManager
  private threadStarted = false
  private currentThreadId: string | null = null
  private emittedAssistantText = false
  private partialText = ''
  private resultError: string | null = null
  private currentSignal: AbortSignal | null = null
  private readonly toolNamesByUseId = new Map<string, string>()

  constructor(
    private readonly context: DesktopAgentRuntimeContext,
  ) {
    this.sidecarManager = new SidecarManager(createTypescriptSidecarOptions(context))

    // 监听 sidecar 的 thread/event → 映射为 DesktopAgentEvent
    this.sidecarManager.on('threadEvent', event => {
      this.handleThreadEvent(event)
    })

    // 监听 sidecar 的 permission requests
    this.sidecarManager.on('permissionRequest', async (context: SidecarPermissionContext) => {
      await this.handlePermissionRequest(context)
    })

    // 监听 sidecar crash → 日志 + 错误回报
    this.sidecarManager.on('crash', (error: Error) => {
      desktopDebug('sidecar_crashed', {
        sessionId: this.context.sessionId,
        message: error.message,
      })
    })
  }

  // ── DesktopAgentRuntime 接口 ──────────────────────────────────────

  setModel(model: string | undefined): void {
    this.context.model = model
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.context.providerID = providerID
    this.context.providerBaseURL = providerBaseURL
    this.setModel(model)
  }

  setPermissionMode(permissionMode: string): void {
    // sidecar 模式：权限模式在 sidecar 启动时通过 env 传递，
    // 运行时改变可能需要重启 sidecar
    console.info(
      `[desktop-runtime] ${new Date().toISOString()} sidecar_set_permission_mode ${JSON.stringify({
        sessionId: this.context.sessionId,
        permissionMode,
      })}`,
    )
  }

  setPlanModeActive(active: boolean): void {
    console.info(
      `[desktop-runtime] ${new Date().toISOString()} sidecar_set_plan_mode ${JSON.stringify({
        sessionId: this.context.sessionId,
        planModeActive: active,
      })}`,
    )
  }

  setDebugConversationDump(enabled: boolean): void {
    this.context.debugConversationDump = enabled
  }

  async runUserTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now()
    desktopDebug('sidecar_turn_start', {
      sessionId: this.context.sessionId,
      textLength: desktopUserMessageTextLength(content),
    })

    this.emittedAssistantText = false
    this.partialText = ''
    this.resultError = null
    this.toolNamesByUseId.clear()
    this.currentSignal = signal

    try {
      // 1. 确保 sidecar 已启动
      await this.ensureSidecarStarted()

      // 2. 确保 thread 已创建
      if (!this.threadStarted) {
        await this.startSidecarThread()
        this.threadStarted = true
      }

      // 3. 发送 turn/start with text content
      // Note: This legacy runtime only supports text turns. Attachments are
      // handled by the RustSidecarDesktopAgentRuntime.
      const turnResult = await this.sidecarManager.startTurn({
        threadId: this.currentThreadId!,
        turnId: `turn-${randomUUID()}`,
        input: typeof content === 'string' ? content : content.text,
      })

      desktopDebug('sidecar_turn_completed', {
        sessionId: this.context.sessionId,
        threadId: this.currentThreadId,
        turnId: turnResult.turnId,
        eventCount: turnResult.eventCount,
        durationMs: Date.now() - startedAt,
      })
    } finally {
      this.currentSignal = null
    }

    if (signal.aborted) {
      desktopDebug('sidecar_turn_aborted', {
        sessionId: this.context.sessionId,
        durationMs: Date.now() - startedAt,
      })
      return
    }

    if (this.resultError) {
      desktopDebug('sidecar_turn_result_error', {
        sessionId: this.context.sessionId,
        durationMs: Date.now() - startedAt,
        message: this.resultError,
      })
      throw new Error(this.resultError)
    }

    desktopDebug('sidecar_turn_done', {
      sessionId: this.context.sessionId,
      durationMs: Date.now() - startedAt,
    })
  }

  async runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now()
    desktopDebug('sidecar_control_response_start', {
      sessionId: this.context.sessionId,
    })

    this.emittedAssistantText = false
    this.partialText = ''
    this.resultError = null
    this.toolNamesByUseId.clear()
    this.currentSignal = signal

    try {
      await this.ensureSidecarStarted()
      if (!this.threadStarted) {
        await this.startSidecarThread()
        this.threadStarted = true
      }

      // 控制响应通过 injectItem 注入到 sidecar 线程
      await this.sidecarManager.startTurn({
        threadId: this.currentThreadId!,
        turnId: `turn-${randomUUID()}`,
        input: JSON.stringify(response),
        isMeta: true,
      })
    } finally {
      this.currentSignal = null
    }

    if (signal.aborted) {
      desktopDebug('sidecar_control_response_aborted', {
        sessionId: this.context.sessionId,
        durationMs: Date.now() - startedAt,
      })
      return
    }
    desktopDebug('sidecar_control_response_done', {
      sessionId: this.context.sessionId,
      durationMs: Date.now() - startedAt,
    })
  }

  getMcpRuntimeStatus(): {
    servers: Array<{
      name: string
      scope: string
      type: string
      status: 'connected' | 'failed' | 'pending' | 'disabled' | 'unsupported'
      error?: string
      toolCount: number
      resourceCount: number
      promptCount: number
    }>
    totalTools: number
    totalResources: number
    totalPrompts: number
  } {
    // sidecar 模式暂不暴露 MCP 状态
    return { servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }
  }

  async refreshMcpConfig(): Promise<'refreshed' | 'not_loaded'> {
    // Legacy sidecar does not support MCP config reload.
    return 'not_loaded'
  }

  // ── 清理 ──────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    try {
      await this.sidecarManager.stop()
    } catch {
      // 忽略清理错误
    }
  }

  // ── Private ───────────────────────────────────────────────────────

  private async ensureSidecarStarted(): Promise<void> {
    if (this.sidecarManager.isRunning) return

    try {
      await this.sidecarManager.start()
      desktopDebug('sidecar_started_ok', {
        sessionId: this.context.sessionId,
      })
    } catch (error) {
      throw new SidecarStartError(
        `Failed to start sidecar: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  private async startSidecarThread(): Promise<void> {
    const threadId = this.context.resumeExistingSession
      ? this.context.sessionId
      : `thread-${randomUUID()}`
    this.currentThreadId = threadId

    const result = await this.sidecarManager.startThread({
      threadId,
      settings: {
        cwd: this.context.workspacePath,
        model: this.context.model,
      },
    })

    desktopDebug('sidecar_thread_started', {
      threadId: result.threadId,
      status: result.status,
    })
  }

  // ── Event 处理 ────────────────────────────────────────────────────

  private handleThreadEvent(event: ThreadEvent): void {
    desktopDebug('sidecar_thread_event_handler', {
      type: event.type,
      threadId: event.threadId,
    })
    // 映射 ThreadEvent → DesktopAgentEvent
    switch (event.type) {
      case 'turn.started':
        this.context.emit({
          type: 'message',
          sessionId: this.context.sessionId,
          role: 'assistant',
          text: '',
        })
        break

      case 'item.completed':
        if ('item' in event) {
          const item = (event as { item: Record<string, unknown> }).item
          if (item.type === 'agent_message' || item.type === 'text') {
            const text = String(item.text ?? '')
            this.context.emit({
              type: 'message',
              sessionId: this.context.sessionId,
              role: 'assistant',
              text,
            })
          } else if (item.type === 'tool_use') {
            const toolName = String(item.name ?? 'Tool')
            if (typeof item.id === 'string') {
              this.toolNamesByUseId.set(item.id, toolName)
            }
            this.context.emit({
              type: 'tool_start',
              sessionId: this.context.sessionId,
              toolName,
              summary: String((item as Record<string, unknown>).input ?? ''),
              toolUseId: String(item.id ?? ''),
            })
          } else if (item.type === 'tool_result') {
            const toolName = this.resolveToolName(item as Record<string, unknown>)
            this.context.emit({
              type: 'tool_result',
              sessionId: this.context.sessionId,
              toolName,
              summary: '',
              toolUseId: String((item as Record<string, unknown>).tool_use_id ?? ''),
              isError: (item as Record<string, unknown>).is_error === true,
            })
          }
        }
        break

      case 'turn.completed': {
        const turnEvent = event as TurnCompletedEvent
        // Emit context usage if the turn carries usage data
        if (isRecord(turnEvent.usage)) {
          const usageRecord: Record<string, unknown> = turnEvent.usage
          const usageModel = usageRecord.model
          const usage = buildDesktopContextUsage({
            model: typeof usageModel === 'string'
              ? usageModel
              : (this.context.model ?? 'unknown'),
            usage: usageRecord,
            provider: this.context.providerID,
          })
          if (usage) {
            this.context.emit({
              type: 'context_usage',
              sessionId: this.context.sessionId,
              usage,
            })
          }
        }
        const finalResponse = turnEvent.finalResponse
        if (finalResponse && finalResponse.trim()) {
          this.context.emit({
            type: 'message',
            sessionId: this.context.sessionId,
            role: 'assistant',
            text: finalResponse,
          })
        }
        break
      }
    }
  }

  private async handlePermissionRequest(context: SidecarPermissionContext): Promise<void> {
    const permissionRequest: DesktopPermissionRequest = {
      requestId: context.requestId,
      toolName: context.toolName,
      toolUseId: context.toolUseId,
      input: context.input,
      description: context.description,
    }

    try {
      const decision = await this.context.requestPermission(permissionRequest)
      const sidecarDecision: SidecarPermissionDecision = {
        behavior: decision.behavior,
        updatedInput: decision.updatedInput,
        alwaysAllow: decision.alwaysAllow,
        message: decision.message,
      }
      this.sidecarManager.respondPermission(context.requestId, sidecarDecision)
    } catch (error) {
      this.sidecarManager.respondPermission(context.requestId, {
        behavior: 'deny',
        message: error instanceof Error ? error.message : 'Permission request failed',
      })
    }
  }

  private resolveToolName(item: Record<string, unknown>): string {
    return typeof item.tool_use_id === 'string'
      ? (this.toolNamesByUseId.get(item.tool_use_id) ?? 'Tool')
      : 'Tool'
  }
}

function createTypescriptSidecarOptions(
  context: DesktopAgentRuntimeContext,
): SidecarManagerOptions {
  return {
    entrypoint: SIDECAR_ENTRYPOINT,
    cwd: context.workspacePath,
    env: buildSidecarEnv({
      sessionId: context.sessionId,
      workspacePath: context.workspacePath,
      model: context.model,
      providerID: context.providerID,
      providerBaseURL: context.providerBaseURL,
      sandboxMode: context.sandboxMode,
      approvalPolicy: context.approvalPolicy,
      approvalsReviewer: context.approvalsReviewer,
      permissionProfile: context.permissionProfile,
      configDirectoryPath: context.configDirectoryPath,
      debugConversationDump: context.debugConversationDump,
      thinkingMode: context.thinkingMode,
      systemPrompt: context.systemPrompt,
      appendSystemPrompt: context.appendSystemPrompt,
      additionalDirectories: context.additionalDirectories,
      installCodePilotXDependencies: context.installCodePilotXDependencies,
      enableMemory: context.enableMemory,
      runtimeEnvironment: context.toolchainEnvironment,
      reviewModel: context.reviewModel,
      smallFastModel: context.smallFastModel,
      fastModel: context.fastModel,
      defaultModel: context.defaultModel,
      deepModel: context.deepModel,
      sessionName: context.sessionName,
    }),
    startTimeoutMs: 15_000,
  }
}

// ── 工具 ──────────────────────────────────────────────────────────

function desktopUserMessageTextLength(content: DesktopUserMessageContent): number {
  if (typeof content === 'string') return content.length
  return content.text.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export class SidecarAgentRuntimeError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'SidecarAgentRuntimeError'
  }
}
