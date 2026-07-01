import { randomUUID } from 'node:crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { runHeadless } from '../cli/print.js'
import { StructuredIO } from '../cli/structuredIO.js'
import type {
  SDKControlResponse,
  StdoutMessage,
} from '../entrypoints/sdk/controlTypes.js'
import {
  setClientType,
  setCwdState,
  getSessionId,
  getSessionProjectDir,
  setOriginalCwd,
  setProjectRoot,
  setSessionTrustAccepted,
  switchSession,
} from '../bootstrap/state.js'
import { createStore, type Store } from '../state/store.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import type { Tool, ToolPermissionContext, Tools } from '../Tool.js'
import { getAllBaseTools } from '../tools.js'
import { getCommands } from '../commands.js'
import { initBuiltinPlugins } from '../plugins/bundled/index.js'
import { runWithCwdOverride } from '../utils/cwd.js'
import { getDenyRuleForTool } from '../utils/permissions/permissions.js'
import type { PermissionMode } from '../types/permissions.js'
import { cacheSessionTitle } from '../utils/sessionStorage.js'
import type { ThinkingConfig } from '../utils/thinking.js'
import { asSessionId } from '../types/ids.js'
import { runWithEmbeddedShutdownHandler } from '../utils/gracefulShutdown.js'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '../utils/envUtils.js'
import { resetRipgrepConfigCache } from '../utils/ripgrep.js'
import { saveSelectedProvider } from '../utils/model/providerConfig.js'
import { runWithConversationDebugDump } from '../utils/conversationDebugDump.js'

export type DesktopHeadlessThinkingMode =
  | 'default'
  | 'enabled'
  | 'adaptive'
  | 'disabled'

export type DesktopHeadlessOutputControls = {
  injectControlResponse(response: Record<string, unknown>): void
}

export type DesktopHeadlessRuntimeOptions = {
  sessionId: string
  workspacePath: string
  configDirectoryPath?: string
  resumeExistingSession?: boolean
  permissionProfile?: string
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
  permissionMode?: PermissionMode
  providerID?: string
  providerBaseURL?: string
  debugConversationDump?: boolean
  model?: string
  reviewModel?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode?: DesktopHeadlessThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  installCodexDependencies?: boolean
  enableMemory?: boolean
  askUserQuestionMaxQuestions?: number
  permissionPromptToolName?: string
  onOutput(
    message: StdoutMessage,
    controls: DesktopHeadlessOutputControls,
  ): Promise<void> | void
}

export type DesktopHeadlessCodexPermissionConfig = {
  permissionProfile?: string
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
}

export type DesktopHeadlessRuntime = {
  setModel(model: string | undefined): void
  setProvider(
    providerID: string | undefined,
    providerBaseURL: string | undefined,
  ): void
  setDebugConversationDump(enabled: boolean): void
  setPermissionMode(permissionMode: PermissionMode | undefined): void
  setCodexPermissionConfig(config: DesktopHeadlessCodexPermissionConfig): void
  runUserTurn(
    content: string | ContentBlockParam[],
    signal: AbortSignal,
  ): Promise<void>
  runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void>
}

const DESKTOP_ENABLED_THINKING_BUDGET = 1_000_000_000
const DESKTOP_WORKFLOW_TOOL_NAMES = new Set([
  'Agent',
  'Skill',
  'TaskOutput',
  'Bash',
  'PowerShell',
  'Read',
  'Edit',
  'Write',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'TaskStop',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'ToolSearch',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'EnterWorktree',
  'ExitWorktree',
  'memory',
])

export function createDesktopHeadlessRuntime(
  options: DesktopHeadlessRuntimeOptions,
): DesktopHeadlessRuntime {
  initBuiltinPlugins()
  return new EmbeddedDesktopHeadlessRuntime(options)
}

export async function runDesktopHeadlessTurn(
  runtime: DesktopHeadlessRuntime,
  content: string | ContentBlockParam[],
  signal: AbortSignal,
): Promise<void> {
  await runtime.runUserTurn(content, signal)
}

export async function runDesktopHeadlessControlResponse(
  runtime: DesktopHeadlessRuntime,
  response: Record<string, unknown>,
  signal: AbortSignal,
): Promise<void> {
  await runtime.runControlResponse(response, signal)
}

class EmbeddedDesktopHeadlessRuntime implements DesktopHeadlessRuntime {
  private hasStartedHeadlessSession = false
  private currentInput: DesktopHeadlessInput | null = null
  private readonly store: Store<ReturnType<typeof getInitialDesktopAppState>>

  constructor(private readonly options: DesktopHeadlessRuntimeOptions) {
    this.store = createStore(getInitialDesktopAppState(options))
    logDesktopHeadless('runtime_created', {
      sessionId: options.sessionId,
      permissionMode: options.permissionMode ?? 'default',
      permissionProfile: options.permissionProfile ?? ':workspace',
      approvalPolicy: options.approvalPolicy ?? 'on-request',
    })
    if (options.configDirectoryPath) {
      process.env[CODEPILOTX_CONFIG_DIR_ENV] = options.configDirectoryPath
      process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = options.configDirectoryPath
    }
    process.env.CODEPILOTX_DISABLE_MDM_READ = '1'
    process.env.CODEPILOTX_DISABLE_MIN_VERSION_CHECK = '1'
    process.env.CLAUDE_CODE_DISABLE_MDM_READ = '1'
    process.env.CLAUDE_CODE_DISABLE_MIN_VERSION_CHECK = '1'
    process.env.CLAUDE_CODE_ENTRYPOINT = 'desktop'
    process.env.CODEPILOTX_INSTALL_CODEX_DEPENDENCIES =
      options.installCodexDependencies === false ? '0' : '1'
    if (options.enableMemory === true) {
      process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
    } else if (options.enableMemory === false) {
      process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    }
    process.env.USE_BUILTIN_RIPGREP = '0'
    applyAskUserQuestionMaxQuestionsEnv(options)
    applyTaskModelEnv(options)
    resetRipgrepConfigCache()
  }

  setModel(model: string | undefined): void {
    this.options.model = model
    applyTaskModelEnv(this.options)
  }

  setProvider(
    providerID: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.options.providerID = providerID
    this.options.providerBaseURL = providerBaseURL
  }

  setDebugConversationDump(enabled: boolean): void {
    this.options.debugConversationDump = enabled
  }

  setPermissionMode(permissionMode: PermissionMode | undefined): void {
    this.options.permissionMode = permissionMode
    logDesktopHeadless('set_permission_mode', {
      sessionId: this.options.sessionId,
      permissionMode: permissionMode ?? 'default',
    })
    this.store.setState(prev => ({
      ...prev,
      toolPermissionContext: {
        ...prev.toolPermissionContext,
        mode: permissionMode ?? 'default',
        isBypassPermissionsModeAvailable:
          permissionMode === 'bypassPermissions',
      },
    }))
  }

  setCodexPermissionConfig(config: DesktopHeadlessCodexPermissionConfig): void {
    this.options.permissionProfile = config.permissionProfile
    this.options.sandboxMode = config.sandboxMode
    this.options.approvalPolicy = config.approvalPolicy
    this.options.approvalsReviewer = config.approvalsReviewer
    const sandboxMode = config.sandboxMode ?? 'workspace-write'
    this.store.setState(prev => ({
      ...prev,
      toolPermissionContext: {
        ...prev.toolPermissionContext,
        permissionProfile:
          config.permissionProfile ?? permissionProfileForSandboxMode(sandboxMode),
        sandboxMode,
        approvalPolicy: config.approvalPolicy ?? 'on-request',
        approvalsReviewer: config.approvalsReviewer ?? 'user',
        isBypassPermissionsModeAvailable:
          prev.toolPermissionContext.mode === 'bypassPermissions' ||
          sandboxMode === 'danger-full-access',
      },
    }))
  }

  async runUserTurn(
    content: string | ContentBlockParam[],
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.options.model?.trim()) {
      throw new Error('Desktop headless runtime requires a specific model.')
    }
    const startedAt = Date.now()
    logDesktopHeadless('turn_start', {
      sessionId: this.options.sessionId,
      textLength: getHeadlessInputTextLength(content),
    })
    await runWithCwdOverride(this.options.workspacePath, async () => {
      if (signal.aborted) {
        logDesktopHeadless('turn_skipped_aborted_before_start', {
          sessionId: this.options.sessionId,
        })
        return
      }
      const input = new DesktopHeadlessInput(
        this.options.sessionId,
        content,
        signal,
      )
      this.currentInput = input
      const previousSession = captureGlobalSessionState()
      this.prepareGlobalSessionState()
      try {
        const commands = await getCommands(this.options.workspacePath)
        logDesktopHeadless('run_headless_start', {
          sessionId: this.options.sessionId,
          resume:
            this.hasStartedHeadlessSession ||
            this.options.resumeExistingSession,
        })
        await runWithConversationDebugDump(
          {
            enabled: this.options.debugConversationDump === true,
            sessionId: this.options.sessionId,
            workspacePath: this.options.workspacePath,
            turnInput: {
              content,
              model: this.options.model,
              providerID: this.options.providerID,
              providerBaseURL: this.options.providerBaseURL,
              permissionMode: this.options.permissionMode,
            },
          },
          () =>
            runWithDesktopExitGuards(() =>
              runHeadless(
                input,
                () => this.store.getState(),
                this.store.setState,
                commands,
                this.tools,
                {},
                [],
                {
                  continue: undefined,
                  resume: this.hasStartedHeadlessSession ||
                    this.options.resumeExistingSession
                    ? this.options.sessionId
                    : undefined,
                  resumeSessionAt: undefined,
                  verbose: true,
                  outputFormat: 'stream-json',
                  jsonSchema: undefined,
                  permissionPromptToolName: this.options.permissionPromptToolName,
                  allowedTools: undefined,
                  thinkingConfig: thinkingConfigFromDesktopMode(
                    this.options.thinkingMode,
                  ),
                  maxTurns: undefined,
                  maxBudgetUsd: undefined,
                  taskBudget: undefined,
                  systemPrompt: this.options.systemPrompt,
                  appendSystemPrompt: this.options.appendSystemPrompt,
                  userSpecifiedModel: this.options.model,
                  teleport: undefined,
                  sdkUrl: undefined,
                  replayUserMessages: true,
                  includePartialMessages: true,
                  forkSession: false,
                  rewindFiles: undefined,
                  enableAuthStatus: false,
                  agent: undefined,
                  workload: undefined,
                  exitOnComplete: false,
                  createStructuredIO: inputPrompt =>
                    this.createStructuredIO(inputPrompt, signal),
                },
              ),
            ),
        )
        logDesktopHeadless('run_headless_done', {
          sessionId: this.options.sessionId,
          durationMs: Date.now() - startedAt,
        })
      } finally {
        restoreGlobalSessionState(previousSession)
        if (this.currentInput === input) {
          input.close()
          this.currentInput = null
        }
      }
    })

    this.hasStartedHeadlessSession = true
    logDesktopHeadless('turn_done', {
      sessionId: this.options.sessionId,
      durationMs: Date.now() - startedAt,
    })
  }

  async runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.options.model?.trim()) {
      throw new Error('Desktop headless runtime requires a specific model.')
    }
    const startedAt = Date.now()
    const input = async function* controlResponseInput(): AsyncIterable<string> {
      yield `${JSON.stringify(response)}\n`
    }
    logDesktopHeadless('control_response_turn_start', {
      sessionId: this.options.sessionId,
    })
    await runWithCwdOverride(this.options.workspacePath, async () => {
      if (signal.aborted) {
        logDesktopHeadless('turn_skipped_aborted_before_start', {
          sessionId: this.options.sessionId,
        })
        return
      }
      const previousSession = captureGlobalSessionState()
      this.prepareGlobalSessionState()
      try {
        const commands = await getCommands(this.options.workspacePath)
        await runHeadless(
          input(),
          () => this.store.getState(),
          this.store.setState,
          commands,
          this.tools,
          {},
          [],
          {
            continue: undefined,
            resume: this.hasStartedHeadlessSession ||
              this.options.resumeExistingSession
              ? this.options.sessionId
              : undefined,
            resumeSessionAt: undefined,
            verbose: true,
            outputFormat: 'stream-json',
            jsonSchema: undefined,
            permissionPromptToolName: this.options.permissionPromptToolName,
            allowedTools: undefined,
            thinkingConfig: thinkingConfigFromDesktopMode(
              this.options.thinkingMode,
            ),
            maxTurns: undefined,
            maxBudgetUsd: undefined,
            taskBudget: undefined,
            systemPrompt: this.options.systemPrompt,
            appendSystemPrompt: this.options.appendSystemPrompt,
            userSpecifiedModel: this.options.model,
            teleport: undefined,
            sdkUrl: undefined,
            replayUserMessages: true,
            includePartialMessages: true,
            forkSession: false,
            rewindFiles: undefined,
            enableAuthStatus: false,
            agent: undefined,
            workload: undefined,
            exitOnComplete: false,
            createStructuredIO: inputPrompt =>
              this.createStructuredIO(inputPrompt, signal),
          },
        )
      } finally {
        restoreGlobalSessionState(previousSession)
      }
    })
    this.hasStartedHeadlessSession = true
    logDesktopHeadless('control_response_turn_done', {
      sessionId: this.options.sessionId,
      durationMs: Date.now() - startedAt,
    })
  }

  private get tools() {
    return getDesktopHeadlessTools(this.store.getState().toolPermissionContext)
  }

  private prepareGlobalSessionState(): void {
    setClientType('desktop')
    setOriginalCwd(this.options.workspacePath)
    setProjectRoot(this.options.workspacePath)
    setCwdState(this.options.workspacePath)
    setSessionTrustAccepted(true)
    switchSession(asSessionId(this.options.sessionId), null)
    if (this.options.sessionName) {
      cacheSessionTitle(this.options.sessionName)
    }
    this.applySelectedProvider()
  }

  private applySelectedProvider(): void {
    const providerID = this.options.providerID?.trim()
    const modelID = this.options.model?.trim()
    if (!providerID || !modelID) return
    const result = saveSelectedProvider({
      providerID,
      modelID,
      baseURL: this.options.providerBaseURL,
    })
    if (result.error) {
      throw result.error
    }
  }

  private createStructuredIO(
    inputPrompt: string | ContentBlockParam[] | AsyncIterable<string>,
    signal: AbortSignal,
  ): StructuredIO {
    let structuredIO: StructuredIO
    structuredIO = new StructuredIO(
      structuredInputFromPrompt(this.options.sessionId, inputPrompt),
      true,
      {
        writeMessage: async message => {
          if (signal.aborted) {
            logDesktopHeadless('output_ignored_aborted', {
              sessionId: this.options.sessionId,
              type: message.type,
            })
            return
          }
          logDesktopHeadless('output', {
            sessionId: this.options.sessionId,
            type: message.type,
            ...(message.type === 'result'
              ? {
                  subtype: (message as Record<string, unknown>).subtype,
                  isError: (message as Record<string, unknown>).is_error,
                  error: firstResultError(message as Record<string, unknown>),
                }
              : {}),
          })
          await this.options.onOutput(message, {
            injectControlResponse: response => {
              logDesktopHeadless('inject_control_response', {
                sessionId: this.options.sessionId,
              })
              structuredIO.injectControlResponse(response as SDKControlResponse)
            },
          })
          if (message.type === 'result') {
            logDesktopHeadless('result_closes_input', {
              sessionId: this.options.sessionId,
            })
            this.currentInput?.close()
          }
        },
      },
    )
    return structuredIO
  }
}

class DesktopHeadlessInput implements AsyncIterable<string> {
  private closed = false
  private readonly lines: string[] = []
  private waiter: (() => void) | null = null

  constructor(
    private readonly sessionId: string,
    prompt: string | ContentBlockParam[],
    private readonly signal: AbortSignal,
  ) {
    logDesktopHeadless('input_create', {
      sessionId,
      textLength: getHeadlessInputTextLength(prompt),
    })
    this.enqueueUserPrompt(prompt)
    if (signal.aborted) {
      this.enqueueInterrupt()
      this.close()
    } else {
      signal.addEventListener('abort', this.onAbort, { once: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    try {
      while (this.lines.length > 0 || !this.closed) {
        const line = this.lines.shift()
        if (line) {
          yield line
          continue
        }
        await new Promise<void>(resolve => {
          this.waiter = resolve
        })
      }
    } finally {
      this.close()
    }
  }

  close(): void {
    if (this.closed) {
      return
    }
    logDesktopHeadless('input_close', { sessionId: this.sessionId })
    this.closed = true
    this.signal.removeEventListener('abort', this.onAbort)
    this.notify()
  }

  private readonly onAbort = (): void => {
    logDesktopHeadless('input_abort', { sessionId: this.sessionId })
    this.enqueueInterrupt()
    this.close()
  }

  private enqueueUserPrompt(prompt: string | ContentBlockParam[]): void {
    this.enqueue({
      type: 'user',
      session_id: this.sessionId,
      message: {
        role: 'user',
        content: prompt,
      },
      parent_tool_use_id: null,
    })
  }

  private enqueueInterrupt(): void {
    this.enqueue({
      type: 'control_request',
      request_id: randomUUID(),
      request: {
        subtype: 'interrupt',
      },
    })
  }

  private enqueue(message: Record<string, unknown>): void {
    if (this.closed) {
      return
    }
    this.lines.push(`${JSON.stringify(message)}\n`)
    this.notify()
  }

  private notify(): void {
    const waiter = this.waiter
    this.waiter = null
    waiter?.()
  }
}

type CapturedGlobalSessionState = {
  sessionId: ReturnType<typeof getSessionId>
  projectDir: string | null
}

function captureGlobalSessionState(): CapturedGlobalSessionState {
  return {
    sessionId: getSessionId(),
    projectDir: getSessionProjectDir(),
  }
}

function restoreGlobalSessionState(state: CapturedGlobalSessionState): void {
  switchSession(state.sessionId, state.projectDir)
}

function logDesktopHeadless(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const suffix =
    Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : ''
  console.info(
    `[desktop-headless] ${new Date().toISOString()} ${event}${suffix}`,
  )
}

function firstResultError(message: Record<string, unknown>): string | undefined {
  if (!Array.isArray(message.errors)) {
    return undefined
  }
  const first = message.errors.find(item => typeof item === 'string')
  return typeof first === 'string' ? first.slice(0, 500) : undefined
}

function getInitialDesktopAppState(options: DesktopHeadlessRuntimeOptions) {
  const appState = getDefaultAppState()
  const sandboxMode = options.sandboxMode ?? 'workspace-write'
  const additionalWorkingDirectories = new Map(
    appState.toolPermissionContext.additionalWorkingDirectories,
  )
  for (const directory of options.additionalDirectories ?? []) {
    additionalWorkingDirectories.set(directory, {
      path: directory,
      source: 'session',
    })
  }
  return {
    ...appState,
    verbose: true,
    thinkingEnabled: options.thinkingMode !== 'disabled',
    toolPermissionContext: {
      ...appState.toolPermissionContext,
      mode: options.permissionMode ?? 'default',
      permissionProfile:
        options.permissionProfile ?? permissionProfileForSandboxMode(sandboxMode),
      approvalPolicy: options.approvalPolicy ?? 'on-request',
      approvalsReviewer: options.approvalsReviewer ?? 'user',
      sandboxMode,
      additionalWorkingDirectories,
      isBypassPermissionsModeAvailable:
        options.permissionMode === 'bypassPermissions' ||
        options.sandboxMode === 'danger-full-access',
    },
  }
}

function permissionProfileForSandboxMode(
  sandboxMode: NonNullable<DesktopHeadlessRuntimeOptions['sandboxMode']>,
): string {
  switch (sandboxMode) {
    case 'read-only':
      return ':read-only'
    case 'danger-full-access':
      return ':danger-full-access'
    case 'workspace-write':
      return ':workspace'
  }
}

function getDesktopHeadlessTools(
  permissionContext: ToolPermissionContext,
): Tools {
  const tools: Tool[] = [
    ...getAllBaseTools().filter(tool =>
      DESKTOP_WORKFLOW_TOOL_NAMES.has(tool.name),
    ),
  ]
  const seen = new Set<string>()
  return tools.filter(tool => {
    if (seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  }).filter(
    tool => !getDenyRuleForTool(permissionContext, tool) && tool.isEnabled(),
  )
}

async function* structuredInputFromPrompt(
  sessionId: string,
  inputPrompt: string | ContentBlockParam[] | AsyncIterable<string>,
): AsyncIterable<string> {
  if (Array.isArray(inputPrompt)) {
    yield `${JSON.stringify({
      type: 'user',
      session_id: sessionId,
      message: {
        role: 'user',
        content: inputPrompt,
      },
      parent_tool_use_id: null,
    })}\n`
    return
  }
  if (typeof inputPrompt !== 'string') {
    yield* inputPrompt
    return
  }
  yield `${JSON.stringify({
    type: 'user',
    session_id: sessionId,
    message: {
      role: 'user',
      content: inputPrompt,
    },
    parent_tool_use_id: null,
  })}\n`
}

function getHeadlessInputTextLength(
  content: string | ContentBlockParam[],
): number {
  if (typeof content === 'string') return content.length
  return content.reduce((sum, block) => {
    if (block.type === 'text') return sum + block.text.length
    return sum
  }, 0)
}

function applyTaskModelEnv(options: DesktopHeadlessRuntimeOptions): void {
  const mainModel = options.model?.trim()
  if (!mainModel) return
  process.env.ANTHROPIC_SMALL_FAST_MODEL =
    options.smallFastModel?.trim() || mainModel
  process.env.CODEPILOTX_FAST_MODEL =
    options.fastModel?.trim() || mainModel
  process.env.CODEPILOTX_DEFAULT_MODEL =
    options.defaultModel?.trim() || mainModel
  process.env.CODEPILOTX_DEEP_MODEL =
    options.deepModel?.trim() || mainModel
}

function applyAskUserQuestionMaxQuestionsEnv(
  options: DesktopHeadlessRuntimeOptions,
): void {
  if (options.askUserQuestionMaxQuestions) {
    process.env.CODEPILOTX_ASK_USER_QUESTION_MAX_QUESTIONS = String(
      options.askUserQuestionMaxQuestions,
    )
  } else {
    delete process.env.CODEPILOTX_ASK_USER_QUESTION_MAX_QUESTIONS
  }
}

function thinkingConfigFromDesktopMode(
  thinkingMode: DesktopHeadlessThinkingMode | undefined,
): ThinkingConfig | undefined {
  switch (thinkingMode) {
    case 'enabled':
      return {
        type: 'enabled',
        budgetTokens: DESKTOP_ENABLED_THINKING_BUDGET,
      }
    case 'adaptive':
      return { type: 'adaptive' }
    case 'disabled':
      return { type: 'disabled' }
    default:
      return undefined
  }
}

async function runWithDesktopExitGuards<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const originalExit = process.exit
  let shutdownRequest: { exitCode: number; reason: string } | null = null
  process.exit = ((code?: string | number | null | undefined): never => {
    throw new Error(
      `Embedded desktop headless runtime attempted process.exit(${String(
        code ?? 0,
      )})`,
    )
  }) as typeof process.exit
  try {
    const result = await runWithEmbeddedShutdownHandler(
      ({ exitCode, reason }) => {
        shutdownRequest = { exitCode, reason }
        logDesktopHeadless('shutdown_requested', {
          exitCode,
          reason,
        })
      },
      operation,
    )
    if (shutdownRequest && shutdownRequest.exitCode !== 0) {
      logDesktopHeadless('shutdown_request_preserved_as_result', {
        exitCode: shutdownRequest.exitCode,
        reason: shutdownRequest.reason,
      })
    }
    return result
  } finally {
    process.exit = originalExit
  }
}
