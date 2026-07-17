import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopComposerAttachment,
  DesktopPermissionMode,
  DesktopSubagentRead,
  DesktopUserMessageInput,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktopClient.js'
import { applyRightDockAction, type RightDockState } from './rightDockState.js'

export function useSubagentDockController({
  debugMode,
  model,
  setRightDockState,
  submitToSession,
  onError,
}: {
  debugMode: boolean
  model: string
  setRightDockState: React.Dispatch<React.SetStateAction<RightDockState>>
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
  const [selectedSubagentTaskId, setSelectedSubagentTaskId] = useState<
    string | null
  >(null)
  const [selectedSubagent, setSelectedSubagent] =
    useState<DesktopSubagentRead | null>(null)
  const [subagentPermissionMode, setSubagentPermissionMode] =
    useState<DesktopPermissionMode>('default')
  const subagentDraftsRef = useRef(
    new Map<
      string,
      { input: string; attachments: DesktopComposerAttachment[] }
    >(),
  )

  const handleAppendSideChatText = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      setSelectedSubagentTaskId(null)
      setSelectedSubagent(null)
      setSideChatInput((previous) => {
        const existing = previous.trim()
        if (!existing) return trimmed
        return `${previous}\n\n${trimmed}`
      })
      setSideChatFocusVersion((version) => version + 1)
      setRightDockState((current) =>
        applyRightDockAction(
          current,
          { type: 'openTool', tool: 'sideChat' },
          { debugMode },
        ),
      )
    },
    [debugMode, setRightDockState],
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
  }, [selectedSubagent?.task.id])

  useEffect(() => {
    if (!selectedSubagentTaskId) return
    void refreshSelectedSubagent().catch((error) =>
      onError(error instanceof Error ? error.message : String(error)),
    )
    const timer = window.setInterval(() => {
      void refreshSelectedSubagent().catch(() => undefined)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [onError, refreshSelectedSubagent, selectedSubagentTaskId])

  const handleOpenSubagent = useCallback(
    (taskId: string): void => {
      if (selectedSubagentTaskId) {
        subagentDraftsRef.current.set(selectedSubagentTaskId, {
          input: sideChatInput,
          attachments: sideChatAttachments,
        })
      }
      const draft = subagentDraftsRef.current.get(taskId)
      setSelectedSubagentTaskId(taskId)
      setSelectedSubagent(null)
      setSideChatInput(draft?.input ?? '')
      setSideChatAttachments(draft?.attachments ?? [])
      setRightDockState((current) =>
        applyRightDockAction(
          current,
          { type: 'openTool', tool: 'sideChat' },
          { debugMode },
        ),
      )
    },
    [
      debugMode,
      selectedSubagentTaskId,
      setRightDockState,
      sideChatAttachments,
      sideChatInput,
    ],
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
