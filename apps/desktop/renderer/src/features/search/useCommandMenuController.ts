import { useEffect, useMemo, useState } from 'react'
import type { SessionListItem } from '../../uiTypes.js'
import {
  buildCommandMenuTasks,
  type CommandMenuTask,
} from './commandMenuModel.js'
import { resolveCommandMenuShortcut } from './commandMenuShortcuts.js'

export type UseCommandMenuControllerOptions = {
  sessions: readonly SessionListItem[]
  pendingPermissionSessionIds?: ReadonlySet<string>
  onSelectTask: (task: CommandMenuTask) => void
}

export type UseCommandMenuControllerResult = {
  query: string
  tasks: readonly CommandMenuTask[]
  setQuery: (query: string) => void
}

export function useCommandMenuController({
  sessions,
  pendingPermissionSessionIds,
  onSelectTask,
}: UseCommandMenuControllerOptions): UseCommandMenuControllerResult {
  const [query, setQuery] = useState('')
  const tasks = useMemo(
    () => buildCommandMenuTasks(
      sessions,
      query,
      pendingPermissionSessionIds,
    ),
    [pendingPermissionSessionIds, query, sessions],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const shortcut = resolveCommandMenuShortcut(event, {
        hasWorkspace: true,
        menuOpen: true,
        taskCount: tasks.length,
      })
      if (shortcut?.type !== 'select-task') return
      const task = tasks[shortcut.index]
      if (!task) return
      event.preventDefault()
      onSelectTask(task)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSelectTask, tasks])

  return { query, tasks, setQuery }
}
