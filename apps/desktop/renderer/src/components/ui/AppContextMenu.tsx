import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight } from 'lucide-react'
import type { DesktopEditAction } from '@codepilotx/shared/desktop-edit-ipc'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from './popoverSizing.js'
import {
  type CapturedEditCommandContext,
  useEditCommands,
} from './EditCommandProvider.js'

export type AppContextMenuItemColor =
  | 'red'
  | 'gray'
  | 'amber'

export type AppContextMenuAction =
  | {
      kind: 'item'
      label: string
      icon?: ReactNode
      shortcut?: string
      color?: AppContextMenuItemColor
      disabled?: boolean
      onSelect: () => void
    }
  | { kind: 'separator' }
  | {
      kind: 'sub'
      label: string
      icon?: ReactNode
      children: AppContextMenuAction[]
    }

export type AppContextMenuProps = {
  trigger: ReactNode
  actions: AppContextMenuAction[]
  size?: '1' | '2'
  variant?: 'solid' | 'soft'
  onOpenChange?: (open: boolean) => void
  includeEditActions?: boolean
} & PopoverSizingProps

export function AppContextMenu({
  trigger,
  actions,
  size = '1',
  variant = 'soft',
  width,
  onOpenChange,
  includeEditActions = true,
}: AppContextMenuProps): ReactNode {
  const editCommands = useEditCommands()
  const [editContext, setEditContext] =
    useState<CapturedEditCommandContext | null>(null)
  const editActions = useMemo(
    () =>
      includeEditActions && editContext
        ? createEditActions(editContext, action => {
            void editCommands.perform(action, editContext)
          })
        : [],
    [editCommands, editContext, includeEditActions],
  )
  const mergedActions = useMemo(
    () => mergeActions(actions, editActions),
    [actions, editActions],
  )

  function handleContextMenu(event: MouseEvent<HTMLSpanElement>): void {
    if (event.defaultPrevented) return
    const nextContext = includeEditActions
      ? editCommands.captureContext(event.target)
      : null
    const nextEditActions = nextContext
      ? createEditActions(nextContext, action => {
          void editCommands.perform(action, nextContext)
        })
      : []
    setEditContext(nextContext)
    if (mergeActions(actions, nextEditActions).length === 0) {
      event.preventDefault()
    }
  }

  return (
    <ContextMenu.Root
      onOpenChange={open => {
        if (!open) setEditContext(null)
        onOpenChange?.(open)
      }}
    >
      <ContextMenu.Trigger asChild onContextMenu={handleContextMenu}>
        {trigger}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="app-context-menu-content sidebar-context-menu-content"
          data-size={size}
          data-variant={variant}
          style={buildPopoverSizingStyle({ width })}
        >
          {mergedActions.map((action, index) =>
            renderAction(action, index, width),
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function renderAction(
  action: AppContextMenuAction,
  key: number,
  width: PopoverSizingProps['width'],
): ReactNode {
  switch (action.kind) {
    case 'separator':
      return (
        <ContextMenu.Separator
          className="app-context-menu-separator sidebar-context-menu-separator"
          key={key}
        />
      )
    case 'sub':
      return (
        <ContextMenu.Sub key={key}>
          <ContextMenu.SubTrigger className="app-context-menu-sub-trigger sidebar-context-menu-sub-trigger">
            <span className="app-context-menu-leading sidebar-context-menu-leading">
              {action.icon}
            </span>
            <span className="app-context-menu-label sidebar-context-menu-label">
              {action.label}
            </span>
            <span className="app-context-menu-trailing sidebar-context-menu-trailing">
              <ChevronRight
                className="app-context-menu-arrow sidebar-context-menu-arrow"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              className="app-context-menu-content sidebar-context-menu-content"
              sideOffset={16}
              style={buildPopoverSizingStyle({ width })}
            >
              {action.children.map((child, childKey) =>
                renderAction(child, childKey, width),
              )}
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
      )
    case 'item':
      return (
        <ContextMenu.Item
          key={key}
          className="app-context-menu-item sidebar-context-menu-item"
          data-color={action.color}
          disabled={action.disabled}
          onSelect={action.onSelect}
        >
          <span className="app-context-menu-leading sidebar-context-menu-leading">
            {action.icon}
          </span>
          <span className="app-context-menu-label sidebar-context-menu-label">
            {action.label}
          </span>
          <span className="app-context-menu-trailing sidebar-context-menu-trailing">
            {action.shortcut ? (
              <span className="app-context-menu-shortcut sidebar-context-menu-shortcut">
                {action.shortcut}
              </span>
            ) : null}
          </span>
        </ContextMenu.Item>
      )
  }
}

const EDIT_ACTION_LABELS: Record<DesktopEditAction, string> = {
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  delete: '删除',
  selectAll: '全选',
}

const EDIT_ACTION_SHORTCUTS: Record<DesktopEditAction, string> = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  cut: 'Ctrl+X',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  delete: 'Delete',
  selectAll: 'Ctrl+A',
}

function createEditActions(
  context: CapturedEditCommandContext,
  perform: (action: DesktopEditAction) => void,
): AppContextMenuAction[] {
  const capabilities = context.getCapabilities()
  const item = (action: DesktopEditAction): AppContextMenuAction => ({
    kind: 'item',
    label: EDIT_ACTION_LABELS[action],
    shortcut: EDIT_ACTION_SHORTCUTS[action],
    disabled: !capabilities[action],
    onSelect: () => perform(action),
  })

  if (context.kind === 'selection') return [item('copy')]
  if (context.kind === 'readonly-editor') {
    return [item('copy'), item('selectAll')]
  }
  return [
    item('undo'),
    item('redo'),
    { kind: 'separator' },
    item('cut'),
    item('copy'),
    item('paste'),
    item('delete'),
    { kind: 'separator' },
    item('selectAll'),
  ]
}

function mergeActions(
  primary: AppContextMenuAction[],
  secondary: AppContextMenuAction[],
): AppContextMenuAction[] {
  const merged = [
    ...trimSeparators(primary),
    ...(hasItems(primary) && hasItems(secondary)
      ? [{ kind: 'separator' as const }]
      : []),
    ...trimSeparators(secondary),
  ]
  return merged.filter(
    (action, index) =>
      action.kind !== 'separator' ||
      (index > 0 && merged[index - 1]?.kind !== 'separator'),
  )
}

function trimSeparators(
  actions: AppContextMenuAction[],
): AppContextMenuAction[] {
  let start = 0
  let end = actions.length
  while (actions[start]?.kind === 'separator') start += 1
  while (actions[end - 1]?.kind === 'separator') end -= 1
  return actions.slice(start, end)
}

function hasItems(actions: AppContextMenuAction[]): boolean {
  return actions.some(action => action.kind !== 'separator')
}
