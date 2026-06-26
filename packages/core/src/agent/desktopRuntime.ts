import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { unsupportedCoreFeature } from '../errors/unsupported.js'
import type { StdoutMessage } from './controlTypes.js'
import type { PermissionMode } from './permissionMode.js'

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
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto'
  permissionMode?: PermissionMode
  model?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode?: DesktopHeadlessThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  askUserQuestionMaxQuestions?: number
  permissionPromptToolName?: string
  onOutput(
    message: StdoutMessage,
    controls: DesktopHeadlessOutputControls,
  ): Promise<void> | void
}

export type DesktopHeadlessRuntime = {
  setModel(model: string | undefined): void
  runUserTurn(
    content: string | ContentBlockParam[],
    signal: AbortSignal,
  ): Promise<void>
}

export function createDesktopHeadlessRuntime(
  _options: DesktopHeadlessRuntimeOptions,
): DesktopHeadlessRuntime {
  unsupportedCoreFeature(
    'desktop headless runtime',
    'Embedded desktop runtime still depends on TUI internals; use subprocess runtime until this wave is migrated.',
  )
}

export async function runDesktopHeadlessTurn(
  runtime: DesktopHeadlessRuntime,
  content: string | ContentBlockParam[],
  signal: AbortSignal,
): Promise<void> {
  await runtime.runUserTurn(content, signal)
}
