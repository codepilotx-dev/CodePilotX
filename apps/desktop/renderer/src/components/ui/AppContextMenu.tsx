import type { ReactNode } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from './popoverSizing.js'

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
} & PopoverSizingProps

export function AppContextMenu({
  trigger,
  actions,
  size = '1',
  variant = 'soft',
  width,
  onOpenChange,
}: AppContextMenuProps): ReactNode {
  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger asChild>{trigger}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="app-context-menu-content sidebar-context-menu-content"
          data-size={size}
          data-variant={variant}
          style={buildPopoverSizingStyle({ width })}
        >
          {actions.map((action, index) => renderAction(action, index, width))}
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
