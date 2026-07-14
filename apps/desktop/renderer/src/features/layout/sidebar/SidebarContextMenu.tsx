import type { ReactNode } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../../components/ui/popoverSizing.js'

export type ContextMenuItemColor =
  | 'red'
  | 'gray'
  | 'amber'

export type ContextMenuAction =
  | {
      kind: 'item'
      label: string
      icon?: ReactNode
      shortcut?: string
      color?: ContextMenuItemColor
      disabled?: boolean
      onSelect: () => void
    }
  | { kind: 'separator' }
  | {
      kind: 'sub'
      label: string
      icon?: ReactNode
      children: ContextMenuAction[]
    }

type Props = {
  trigger: ReactNode
  actions: ContextMenuAction[]
  size?: '1' | '2'
  variant?: 'solid' | 'soft'
} & PopoverSizingProps

export function SidebarContextMenu({
  trigger,
  actions,
  size = '1',
  variant = 'soft',
  width,
}: Props): ReactNode {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{trigger}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="sidebar-context-menu-content"
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
  action: ContextMenuAction,
  key: number,
  width: PopoverSizingProps['width'],
): ReactNode {
  switch (action.kind) {
    case 'separator':
      return (
        <ContextMenu.Separator
          className="sidebar-context-menu-separator"
          key={key}
        />
      )
    case 'sub':
      return (
        <ContextMenu.Sub key={key}>
          <ContextMenu.SubTrigger className="sidebar-context-menu-sub-trigger">
            <span className="sidebar-context-menu-leading">{action.icon}</span>
            <span className="sidebar-context-menu-label">{action.label}</span>
            <span className="sidebar-context-menu-trailing">
              <ChevronRight
                className="sidebar-context-menu-arrow"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              className="sidebar-context-menu-content"
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
          className="sidebar-context-menu-item"
          data-color={action.color}
          disabled={action.disabled}
          onSelect={action.onSelect}
        >
          <span className="sidebar-context-menu-leading">{action.icon}</span>
          <span className="sidebar-context-menu-label">{action.label}</span>
          <span className="sidebar-context-menu-trailing">
            {action.shortcut ? (
              <span className="sidebar-context-menu-shortcut">
                {action.shortcut}
              </span>
            ) : null}
          </span>
        </ContextMenu.Item>
      )
  }
}
