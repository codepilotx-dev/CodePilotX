import type React from 'react'
import { useCallback, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import {
  FileSearch,
  FolderOpen,
  LoaderCircle,
  Search,
  SquarePen,
} from 'lucide-react'
import type {
  DesktopSessionCatalogStatus,
} from '../../../shared/types.js'
import { useDialogFocusRestore } from '../../components/ui/useDialogFocusRestore.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { SessionListItem } from '../../uiTypes.js'
import type { CommandMenuTask } from './commandMenuModel.js'
import { useCommandMenuController } from './useCommandMenuController.js'

export type CommandMenuDialogProps = {
  open: boolean
  sessions: readonly SessionListItem[]
  pendingPermissionSessionIds?: ReadonlySet<string>
  catalogStatus: DesktopSessionCatalogStatus
  hasWorkspace: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  onOpenChange: (open: boolean) => void
  onSelectTask: (task: CommandMenuTask) => void
  onCreateTask: () => void
  onOpenFolder: () => void
  onSearchFiles: () => void
}

type Recommendation = {
  id: 'new-task' | 'open-folder' | 'search-files'
  label: string
  description?: string
  shortcut: string
  icon: React.ReactNode
  disabled?: boolean
  action: () => void
}

export function CommandMenuDialog({
  open,
  sessions,
  pendingPermissionSessionIds,
  catalogStatus,
  hasWorkspace,
  inputRef,
  onOpenChange,
  onSelectTask,
  onCreateTask,
  onOpenFolder,
  onSearchFiles,
}: CommandMenuDialogProps): React.ReactNode {
  const internalInputRef = useRef<HTMLInputElement | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const setInputRef = useCallback(
    (element: HTMLInputElement | null): void => {
      internalInputRef.current = element
      if (inputRef) inputRef.current = element
    },
    [inputRef],
  )
  const { query, setQuery, tasks } = useCommandMenuController({
    sessions,
    pendingPermissionSessionIds,
    onSelectTask,
  })
  const showRecommendations = query.trim().length === 0
  const recommendations: Recommendation[] = [
    {
      id: 'new-task',
      label: '新建任务',
      shortcut: 'Ctrl+N',
      icon: <SquarePen aria-hidden="true" size={APP_ICON_SIZE} />,
      action: onCreateTask,
    },
    {
      id: 'open-folder',
      label: '打开文件夹',
      shortcut: 'Ctrl+O',
      icon: <FolderOpen aria-hidden="true" size={APP_ICON_SIZE} />,
      action: onOpenFolder,
    },
    {
      id: 'search-files',
      label: '搜索文件',
      description: hasWorkspace ? undefined : '请先打开文件夹',
      shortcut: 'Ctrl+P',
      icon: <FileSearch aria-hidden="true" size={APP_ICON_SIZE} />,
      disabled: !hasWorkspace,
      action: onSearchFiles,
    },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {open ? (
          <Dialog.Overlay className="command-menu-backdrop">
            <Dialog.Content
              aria-describedby="command-menu-description"
              className="command-menu-dialog"
              onCloseAutoFocus={onCloseAutoFocus}
              onOpenAutoFocus={event => {
                event.preventDefault()
                internalInputRef.current?.focus()
                internalInputRef.current?.select()
              }}
            >
              <Dialog.Title className="u-sr-only">
                任务命令菜单
              </Dialog.Title>
              <Dialog.Description
                className="u-sr-only"
                id="command-menu-description"
              >
                搜索最近任务，或执行常用操作。
              </Dialog.Description>
              <Command
                className="command-menu"
                label="搜索任务"
                shouldFilter={false}
                vimBindings={false}
              >
                <div className="command-menu-search">
                  <Search
                    aria-hidden="true"
                    className="command-menu-search-icon"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                  <input
                    aria-keyshortcuts="Control+K Control+Shift+P"
                    aria-label="搜索任务"
                    className="command-menu-input"
                    defaultValue={query}
                    onChange={event => setQuery(event.currentTarget.value)}
                    placeholder="搜索任务"
                    ref={setInputRef}
                    type="search"
                  />
                </div>
                <Command.List className="command-menu-list">
                  <CommandMenuTaskGroup
                    catalogStatus={catalogStatus}
                    query={query}
                    tasks={tasks}
                    onSelectTask={onSelectTask}
                  />
                  {showRecommendations ? (
                    <Command.Group
                      className="command-menu-group"
                      heading="推荐"
                    >
                      {recommendations.map(recommendation => (
                        <Command.Item
                          className="command-menu-item command-menu-recommendation"
                          disabled={recommendation.disabled}
                          key={recommendation.id}
                          onSelect={() => {
                            if (!recommendation.disabled) {
                              recommendation.action()
                            }
                          }}
                          value={`recommendation:${recommendation.id}`}
                        >
                          <span className="command-menu-item-status command-menu-item-icon">
                            {recommendation.icon}
                          </span>
                          <span className="command-menu-item-copy">
                            <span className="command-menu-item-title">
                              {recommendation.label}
                            </span>
                            {recommendation.description ? (
                              <span className="command-menu-item-description">
                                {recommendation.description}
                              </span>
                            ) : null}
                          </span>
                          <kbd className="command-menu-shortcut">
                            {recommendation.shortcut}
                          </kbd>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                </Command.List>
              </Command>
            </Dialog.Content>
          </Dialog.Overlay>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CommandMenuTaskGroup({
  catalogStatus,
  query,
  tasks,
  onSelectTask,
}: {
  catalogStatus: DesktopSessionCatalogStatus
  query: string
  tasks: readonly CommandMenuTask[]
  onSelectTask: (task: CommandMenuTask) => void
}): React.ReactNode {
  const emptyLabel = query.trim() ? '没有找到匹配的任务' : '暂无任务'

  return (
    <Command.Group className="command-menu-group" heading="任务">
      {catalogStatus.state === 'loading' ? (
        <CommandMenuStatus busy>正在加载任务目录…</CommandMenuStatus>
      ) : catalogStatus.state === 'unavailable' ? (
        <CommandMenuStatus>任务目录暂不可用，请稍后重试。</CommandMenuStatus>
      ) : tasks.length === 0 ? (
        <CommandMenuStatus>{emptyLabel}</CommandMenuStatus>
      ) : (
        tasks.map(task => (
          <Command.Item
            className="command-menu-item command-menu-task"
            key={task.id}
            onSelect={() => onSelectTask(task)}
            value={`task:${task.id}`}
          >
            <TaskStatus task={task} />
            <span className="command-menu-item-copy">
              <span className="command-menu-item-title">{task.title}</span>
            </span>
            <span className="command-menu-workspace">
              {task.workspaceName}
            </span>
            <kbd className="command-menu-shortcut">
              {task.shortcutLabel}
            </kbd>
          </Command.Item>
        ))
      )}
    </Command.Group>
  )
}

function CommandMenuStatus({
  busy = false,
  children,
}: {
  busy?: boolean
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Command.Item
      aria-busy={busy || undefined}
      className="command-menu-status"
      disabled
      value="command-menu-status"
    >
      {busy ? (
        <LoaderCircle
          aria-hidden="true"
          className="command-menu-spinner"
          size={APP_ICON_SIZE}
        />
      ) : null}
      <span>{children}</span>
    </Command.Item>
  )
}

function TaskStatus({
  task,
}: {
  task: CommandMenuTask
}): React.ReactNode {
  if (
    task.visualState === 'needs-input'
    || task.visualState === 'running'
  ) {
    return (
      <span
        aria-label={
          task.visualState === 'needs-input'
            ? '任务正在等待输入'
            : '任务正在运行'
        }
        className="command-menu-item-status"
        role="img"
      >
        <LoaderCircle
          aria-hidden="true"
          className="command-menu-spinner"
          size={APP_ICON_SIZE}
        />
      </span>
    )
  }
  if (task.visualState === 'unread') {
    return (
      <span
        aria-label="任务有未读更新"
        className="command-menu-item-status"
        role="img"
      >
        <span aria-hidden="true" className="command-menu-unread-dot" />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className="command-menu-item-status"
    />
  )
}
