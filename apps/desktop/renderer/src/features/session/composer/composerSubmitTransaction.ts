import type { DesktopUserMessageInput } from '../../../../shared/types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../../shared/desktopUserMessage.js'
import { toUserErrorMessage } from '../../../utils/errors.js'
import type {
  ComposerDraft,
  ComposerSubmitOutcome,
  PreparedComposerSubmission,
} from './composerTypes.js'
import { cloneDraft } from './composerDraftStore.js'
import { skillInvocationsFromComposerDocument } from './composerSkillToken.js'
import {
  annotationAttachments,
  validateAnnotationCapacity,
} from '../../browser/browserAnnotationDraft.js'

export type ComposerDeliveryStatus = 'sent' | 'queued'

type SubmitTransactionOptions = {
  draft: ComposerDraft
  targetSessionId?: string | null
  createSession?: (
    initialSessionName?: string,
    projectlessPrompt?: string,
  ) => Promise<string | null>
  navigateToSession?: (sessionId: string) => void
  submitToSession: (
    sessionId: string,
    input: DesktopUserMessageInput,
    metadata: { inputId: string },
  ) => Promise<ComposerDeliveryStatus | void>
}

export function prepareComposerSubmission(
  draft: ComposerDraft,
): PreparedComposerSubmission | ComposerSubmitOutcome {
  const snapshot = cloneDraft(draft)
  if (Object.keys(snapshot.browserAnnotationFeedback ?? {}).length)
    return failed('prepare', '请先保存或取消正在编辑的批注反馈')
  try {
    validateAnnotationCapacity(snapshot)
  } catch (error) {
    return failed('prepare', error instanceof Error ? error.message : '批注附件不可用')
  }
  const attachments = annotationAttachments(snapshot)
  const text = serializeComposerDocument(snapshot.document)
  const skills =
    snapshot.skills ??
    (snapshot.skillInvocation
      ? [snapshot.skillInvocation]
      : skillInvocationsFromComposerDocument(snapshot.document))
  const hasContent = Boolean(text.trim()) || attachments.length > 0 || skills.length > 0

  if (!hasContent) {
    return failed('prepare', '请输入消息或添加附件')
  }
  if (hasBlockingComposerAttachmentErrors(snapshot.attachments)) {
    return failed('prepare', '请先移除或修复不可用的附件')
  }

  return {
    clientId: snapshot.clientId,
    input: {
      text,
      attachments,
      ...(skills.length ? { skills } : {}),
    },
    sessionName: skills.length
      ? `${skills.map((skill) => `$${skill.name}`).join(' ')} ${text}`.trim()
      : undefined,
  }
}

export function serializeComposerDocument(document: ComposerDraft['document']): string {
  const references = document.tokens
    .filter((token) => token.kind === 'thread' || token.kind === 'browser')
    .map((token) => `[${escapeMarkdownLabel(token.label)}](<${token.value.replace(/>/gu, '%3E')}>)`)
  if (references.length === 0) return document.text
  return `${references.join(' ')}${document.text.trim() ? `\n\n${document.text}` : ''}`
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/gu, '\\$1')
}

export async function executeComposerSubmitTransaction({
  draft,
  targetSessionId,
  createSession,
  navigateToSession,
  submitToSession,
}: SubmitTransactionOptions): Promise<ComposerSubmitOutcome> {
  const prepared = prepareComposerSubmission(draft)
  if ('status' in prepared) return prepared

  let sessionId = targetSessionId ?? null
  if (!sessionId) {
    if (!createSession) {
      return failed('prepare', '缺少可用的会话目标')
    }
    try {
      sessionId = await createSession(prepared.sessionName, prepared.input.text)
    } catch (error) {
      return failed('create', errorMessageOf(error))
    }
    if (!sessionId) {
      return failed('create', '无法创建新会话')
    }
    navigateToSession?.(sessionId)
  }

  try {
    const deliveryStatus = await submitToSession(sessionId, prepared.input, {
      inputId: prepared.clientId,
    })
    return {
      status: deliveryStatus === 'queued' ? 'queued' : 'sent',
      sessionId,
    }
  } catch (error) {
    return failed('send', errorMessageOf(error), sessionId)
  }
}

function failed(
  phase: 'prepare' | 'create' | 'send',
  message: string,
  sessionId?: string,
): ComposerSubmitOutcome {
  return {
    status: 'failed',
    phase,
    message,
    sessionId,
  }
}

/**
 * Creates the task for a new-session submit. A failure here blocks sending, so it is
 * reported exactly once through the global error channel; recovery is another submit,
 * never an inline control.
 */
export async function createTaskSession(input: {
  create: () => Promise<string | null>
  onError?: (message: string) => void
}): Promise<string | null> {
  try {
    const sessionId = await input.create()
    if (!sessionId) input.onError?.('无法创建任务，请重试或选择本地目录。')
    return sessionId
  } catch (error) {
    input.onError?.(toUserErrorMessage(error, 'thread-create'))
    throw error
  }
}

function errorMessageOf(error: unknown): string {
  return toUserErrorMessage(error)
}
