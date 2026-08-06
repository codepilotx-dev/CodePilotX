import { useCallback, useEffect, useState } from 'react'
import type { DesktopSubagentRead } from '../../../../shared/types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { WorkbenchTabDescriptor } from './rightDockState.js'

export function useSubagentDockController({
  activeSideTaskId,
  openRightDockTab,
  onError,
}: {
  activeSideTaskId: string | null
  openRightDockTab: (tab: WorkbenchTabDescriptor) => void
  onError: (message: string) => void
}) {
  const [selectedSubagent, setSelectedSubagent] =
    useState<DesktopSubagentRead | null>(null)

  const selectedSubagentTaskId = activeSideTaskId

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
    selectedSubagentTaskId,
    selectedSubagent,
    refreshSelectedSubagent,
    handleOpenSubagent,
  }
}
