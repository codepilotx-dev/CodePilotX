import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopComposerAttachment,
  DesktopUserMessageInput,
} from '../../../../shared/types.js'
import type {
  ComposerDeliveryIntent,
  ComposerDraftContentSnapshot,
  ComposerDraftKey,
} from '../../session/composer/composerTypes.js'
import type { WorkbenchTabDescriptor } from './rightDockState.js'

type Draft = {
  input: string
  attachments: DesktopComposerAttachment[]
}

export function useSideChatController({
  openRightDockTab,
  submitToSession,
}: {
  openRightDockTab: (tab: WorkbenchTabDescriptor) => void
  submitToSession: (
    sessionId: string,
    input: DesktopUserMessageInput,
    options?: {
      delivery?: ComposerDeliveryIntent
      inputId?: string
      propagateError?: boolean
    },
  ) => Promise<'sent' | 'queued' | 'steered' | null>
}) {
  const [sideChatInput, setSideChatInput] = useState('')
  const [sideChatFocusVersion, setSideChatFocusVersion] = useState(0)
  const [sideChatAttachments, setSideChatAttachments] = useState<
    DesktopComposerAttachment[]
  >([])
  const draftsRef = useRef(new Map<string, Draft>())
  const activeComposerKeyRef = useRef('side-chat')
  const inputRef = useRef(sideChatInput)
  const attachmentsRef = useRef(sideChatAttachments)
  inputRef.current = sideChatInput
  attachmentsRef.current = sideChatAttachments

  // 侧边聊天只服务一个 composer 草稿；保留 draft 映射以兼容附件追加与提交清理。
  const activeComposerKey = 'side-chat'

  useEffect(() => {
    const previousKey = activeComposerKeyRef.current
    if (previousKey === activeComposerKey) return
    draftsRef.current.set(previousKey, {
      input: inputRef.current,
      attachments: attachmentsRef.current,
    })
    const nextDraft = draftsRef.current.get(activeComposerKey)
    activeComposerKeyRef.current = activeComposerKey
    setSideChatInput(nextDraft?.input ?? '')
    setSideChatAttachments(nextDraft?.attachments ?? [])
  }, [activeComposerKey])

  const handleAppendSideChatText = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      openRightDockTab({ id: 'side-chat', kind: 'side-chat' })
      setSideChatInput(previous => {
        const existing = previous.trim()
        if (!existing) return trimmed
        return `${previous}\n\n${trimmed}`
      })
      setSideChatFocusVersion(version => version + 1)
    },
    [openRightDockTab],
  )

  const sideChatSubmitToSession = useCallback(
    async (
      sessionId: string,
      value: DesktopUserMessageInput,
      options?: {
        delivery?: ComposerDeliveryIntent
        inputId?: string
        propagateError?: boolean
      },
    ): Promise<'sent' | 'queued'> => {
      const outcome = await submitToSession(sessionId, value, options)
      if (!outcome) throw new Error('发送失败，请重试')
      return outcome === 'queued' ? 'queued' : 'sent'
    },
    [submitToSession],
  )

  const appendSideComposerAttachmentsForDraft = useCallback(
    (
      draftKey: ComposerDraftKey,
      nextAttachments: DesktopComposerAttachment[],
    ): void => {
      if (nextAttachments.length === 0) return
      const key = draftKey
      const current =
        activeComposerKeyRef.current === key
          ? attachmentsRef.current
          : draftsRef.current.get(key)?.attachments ?? []
      const existingIds = new Set(current.map(attachment => attachment.id))
      const next = [
        ...current,
        ...nextAttachments.filter(attachment => !existingIds.has(attachment.id)),
      ]
      draftsRef.current.set(key, {
        input:
          activeComposerKeyRef.current === key
            ? inputRef.current
            : draftsRef.current.get(key)?.input ?? '',
        attachments: next,
      })
      if (activeComposerKeyRef.current === key) {
        attachmentsRef.current = next
        setSideChatAttachments(next)
      }
    },
    [],
  )

  const removeSideComposerAttachmentForDraft = useCallback(
    (draftKey: ComposerDraftKey, attachmentId: string): void => {
      const key = draftKey
      const current =
        activeComposerKeyRef.current === key
          ? attachmentsRef.current
          : draftsRef.current.get(key)?.attachments ?? []
      const next = current.filter(attachment => attachment.id !== attachmentId)
      draftsRef.current.set(key, {
        input:
          activeComposerKeyRef.current === key
            ? inputRef.current
            : draftsRef.current.get(key)?.input ?? '',
        attachments: next,
      })
      if (activeComposerKeyRef.current === key) {
        attachmentsRef.current = next
        setSideChatAttachments(next)
      }
    },
    [],
  )

  const clearSideComposerDraftIfUnchanged = useCallback(
    (
      draftKey: ComposerDraftKey,
      snapshot: ComposerDraftContentSnapshot,
    ): boolean => {
      const key = draftKey
      const current =
        activeComposerKeyRef.current === key
          ? { input: inputRef.current, attachments: attachmentsRef.current }
          : draftsRef.current.get(key) ?? { input: '', attachments: [] }
      if (
        current.input !== snapshot.text ||
        !sameAttachmentIds(current.attachments, snapshot.attachments)
      ) {
        return false
      }
      draftsRef.current.set(key, { input: '', attachments: [] })
      if (activeComposerKeyRef.current === key) {
        inputRef.current = ''
        attachmentsRef.current = []
        setSideChatInput('')
        setSideChatAttachments([])
      }
      return true
    },
    [],
  )

  return {
    sideChatInput,
    setSideChatInput,
    sideChatFocusVersion,
    sideChatAttachments,
    setSideChatAttachments,
    handleAppendSideChatText,
    sideChatSubmitToSession,
    appendSideComposerAttachmentsForDraft,
    removeSideComposerAttachmentForDraft,
    clearSideComposerDraftIfUnchanged,
  }
}

function sameAttachmentIds(
  left: DesktopComposerAttachment[],
  right: DesktopComposerAttachment[],
): boolean {
  return (
    left.length === right.length &&
    left.every((attachment, index) => attachment.id === right[index]?.id)
  )
}
