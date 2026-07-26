import type { DesktopUserMessageInput } from '../../../../shared/types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../../shared/desktopUserMessage.js'
import type {
  ComposerDraft,
  ComposerSubmitOutcome,
  PreparedComposerSubmission,
} from './composerTypes.js'
import { cloneDraft } from './composerDraftStore.js'

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
  const text = snapshot.document.text
  const hasContent =
    Boolean(text.trim()) ||
    snapshot.attachments.length > 0 ||
    Boolean(snapshot.skillInvocation)

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
      attachments: snapshot.attachments,
      skillInvocation: snapshot.skillInvocation
        ? {
            name: snapshot.skillInvocation.name,
            skillPath: snapshot.skillInvocation.path,
          }
        : undefined,
    },
    sessionName: snapshot.skillInvocation
      ? `$${snapshot.skillInvocation.name} ${text}`.trim()
      : undefined,
  }
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
    const deliveryStatus = await submitToSession(
      sessionId,
      prepared.input,
      { inputId: prepared.clientId },
    )
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

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
