import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopComposerAttachment,
  DesktopPermissionMode,
  DesktopSubagentRead,
  DesktopUserMessageInput,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktopClient.js'
import type { WorkbenchTabDescriptor } from './rightDockState.js'

type Draft = {
  input: string
  attachments: DesktopComposerAttachment[]
}

export function useSubagentDockController({
  activeSideTaskId,
  model,
  openRightDockTab,
  submitToSession,
  onError,
}: {
  activeSideTaskId: string | null
  model: string
  openRightDockTab: (tab: WorkbenchTabDescriptor) => void
  submitToSession: (
    sessionId: string,
    input: DesktopUserMessageInput,
  ) => Promise<void>
  onError: (message: string) => void
}) {
  const [sideChatInput, setSideChatInput] = useState('')
  const [sideChatFocusVersion, setSideChatFocusVersion] = useState(0)
  const [sideChatAttachments, setSideChatAttachments] = useState<
    DesktopComposerAttachment[]
  >([])
  const [selectedSubagent, setSelectedSubagent] =
    useState<DesktopSubagentRead | null>(null)
  const [subagentPermissionMode, setSubagentPermissionMode] =
    useState<DesktopPermissionMode>('default')
  const draftsRef = useRef(new Map<string, Draft>())
  const activeComposerKeyRef = useRef('side-chat')
  const inputRef = useRef(sideChatInput)
  const attachmentsRef = useRef(sideChatAttachments)
  inputRef.current = sideChatInput
  attachmentsRef.current = sideChatAttachments

  const selectedSubagentTaskId = activeSideTaskId
  const activeComposerKey = activeSideTaskId
    ? `side-task:${activeSideTaskId}`
    : 'side-chat'

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
    ): Promise<void> => {
      if (selectedSubagentTaskId && desktopClient.sendSubagent) {
        await desktopClient.sendSubagent(
          selectedSubagentTaskId,
          value,
          model,
          selectedSubagent?.task.profile === 'explorer'
            ? undefined
            : subagentPermissionMode,
        )
      } else {
        await submitToSession(sessionId, value)
      }
      setSideChatInput('')
      setSideChatAttachments([])
    },
    [
      model,
      selectedSubagent?.task.profile,
      selectedSubagentTaskId,
      subagentPermissionMode,
      submitToSession,
    ],
  )

  const refreshSelectedSubagent = useCallback(async (): Promise<void> => {
    if (!selectedSubagentTaskId || !desktopClient.readSubagent) {
      setSelectedSubagent(null)
      return
    }
    setSelectedSubagent(
      await desktopClient.readSubagent(selectedSubagentTaskId),
    )
  }, [selectedSubagentTaskId])

  useEffect(() => {
    const config = selectedSubagent?.currentRun?.permissionConfig
    if (!config) return
    setSubagentPermissionMode(
      config.sandboxMode === 'danger-full-access'
        ? 'full-access'
        : config.approvalsReviewer === 'auto_review'
          ? 'auto-review'
          : 'default',
    )
  }, [selectedSubagent?.task.id, selectedSubagent?.currentRun?.permissionConfig])

  useEffect(() => {
    if (!selectedSubagentTaskId) {
      setSelectedSubagent(null)
      return
    }
    void refreshSelectedSubagent().catch(error =>
      onError(error instanceof Error ? error.message : String(error)),
    )
    const timer = window.setInterval(() => {
      void refreshSelectedSubagent().catch(() => undefined)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [onError, refreshSelectedSubagent, selectedSubagentTaskId])

  const handleOpenSubagent = useCallback(
    (taskId: string): void => {
      if (!desktopClient.readSubagent) {
        onError('当前桌面桥接不支持读取子智能体')
        return
      }
      void desktopClient
        .readSubagent(taskId)
        .then(read => {
          openRightDockTab({
            id: `side-task:${taskId}`,
            kind: 'side-task',
            taskId,
            childThreadId: read.task.childThreadId,
          })
        })
        .catch(error =>
          onError(error instanceof Error ? error.message : String(error)),
        )
    },
    [onError, openRightDockTab],
  )

  return {
    sideChatInput,
    setSideChatInput,
    sideChatFocusVersion,
    sideChatAttachments,
    setSideChatAttachments,
    selectedSubagentTaskId,
    selectedSubagent,
    subagentPermissionMode,
    setSubagentPermissionMode,
    handleAppendSideChatText,
    sideChatSubmitToSession,
    refreshSelectedSubagent,
    handleOpenSubagent,
  }
}
