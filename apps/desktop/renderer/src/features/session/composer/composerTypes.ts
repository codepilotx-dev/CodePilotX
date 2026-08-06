import type {
  DesktopComposerAttachment,
  DesktopUserMessageInput,
} from '../../../../shared/types.js'

export type ComposerPlacement = 'new-session' | 'thread' | 'side-task'

/** 新建页展示上下文；thread 内不设置，保持现有行为。 */
export type ComposerSurface = 'coding' | 'working' | 'chat'

/** 当前唯一的工作插件；仅属于新建页草稿的本地 UI 状态。 */
export type WorkingPlugin = 'task-planning'

export type ComposerExecutionMode = 'local' | 'worktree' | 'cloud'

export type ComposerCollaborationMode = 'default' | 'plan'

export type ComposerSubmitShortcut =
  | 'enter'
  | 'multiline-ctrl-enter'
  | 'ctrl-enter'

export type ComposerDeliveryIntent = 'default' | 'follow-up'

export type ComposerStackMode =
  | { kind: 'input' }
  | { kind: 'permission'; requestId: string }
  | { kind: 'question'; requestId: string }
  | { kind: 'mcp'; requestId: string }

export type ComposerCapabilities = {
  localExecution: boolean
  worktreeExecution: boolean
  cloudExecution: boolean
  remoteHost: boolean
  fileAttachments: boolean
  clipboardBlobAttachments: boolean
  skills: boolean
  plugins: boolean
  mcpResources: boolean
  ideContext: boolean
  dictation: boolean
  voiceMode: boolean
  review: boolean
  goals: boolean
  status: boolean
}

/**
 * Capabilities backed by the current renderer and desktop client. Features
 * without a real data source stay false so consumers can omit them entirely.
 */
export const DEFAULT_COMPOSER_CAPABILITIES: Readonly<ComposerCapabilities> =
  Object.freeze({
    localExecution: true,
    worktreeExecution: false,
    cloudExecution: false,
    remoteHost: false,
    fileAttachments: true,
    clipboardBlobAttachments: false,
    skills: true,
    plugins: false,
    mcpResources: false,
    ideContext: false,
    dictation: false,
    voiceMode: false,
    review: true,
    goals: true,
    status: true,
  })

export function resolveComposerCapabilities(
  overrides: Partial<ComposerCapabilities> = {},
): ComposerCapabilities {
  return {
    ...DEFAULT_COMPOSER_CAPABILITIES,
    ...overrides,
  }
}

export type ComposerTokenKind =
  | 'skill'
  | 'file'
  | 'thread'
  | 'agent'
  | 'plugin'
  | 'prompt-macro'
  | 'slash-command'
  | 'mode'

export type ComposerDocumentToken = {
  id: string
  kind: ComposerTokenKind
  label: string
  value: string
  from: number
  to: number
}

/**
 * Neutral editor document. ProseMirror owns its internal state, while this
 * shape is the serializable draft boundary shared by every placement.
 */
export type ComposerDocument = {
  text: string
  tokens: ComposerDocumentToken[]
}

export type ComposerDraftKey =
  | 'home'
  | `session:${string}`
  | 'side-chat'

export type ComposerSkillInvocation = {
  name: string
  path: string
}

export type ComposerDraft = {
  clientId: string
  document: ComposerDocument
  attachments: DesktopComposerAttachment[]
  skillInvocation?: ComposerSkillInvocation
  collaborationMode: ComposerCollaborationMode
  suggestionOrigin?: string
}

export type ComposerDraftContentSnapshot = {
  text: string
  attachments: DesktopComposerAttachment[]
}

export type ComposerSubmitFailurePhase = 'prepare' | 'create' | 'send'

export type ComposerSubmitOutcome =
  | { status: 'sent'; sessionId: string }
  | { status: 'queued'; sessionId: string }
  | {
      status: 'failed'
      phase: ComposerSubmitFailurePhase
      message: string
      sessionId?: string
    }

export type PreparedComposerSubmission = {
  clientId: string
  input: DesktopUserMessageInput
  sessionName?: string
}

export type ComposerAttachmentState =
  | { status: 'loading'; generation: number }
  | { status: 'ready'; generation: number }
  | { status: 'error'; generation: number; message: string }

export function createComposerDocument(text = ''): ComposerDocument {
  return { text, tokens: [] }
}
