import type { ReactNode } from 'react'
import { ContextMenu, Theme } from '@radix-ui/themes'
import { useDesktopTheme } from '../../theme/themeContext.js'

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
}

export function SidebarContextMenu({
  trigger,
  actions,
  size = '1',
  variant = 'soft',
}: Props): ReactNode {
  const { resolvedVariant } = useDesktopTheme()
  return (
    <Theme appearance={resolvedVariant} hasBackground={false}>
      <ContextMenu.Root>
        <ContextMenu.Trigger>{trigger}</ContextMenu.Trigger>
        <ContextMenu.Content
          className="sidebar-context-menu-content"
          size={size}
          variant={variant}
        >
          {actions.map((action, index) => renderAction(action, index))}
        </ContextMenu.Content>
      </ContextMenu.Root>
    </Theme>
  )
}

function renderAction(action: ContextMenuAction, key: number): ReactNode {
  switch (action.kind) {
    case 'separator':
      return <ContextMenu.Separator key={key} />
    case 'sub':
      return (
        <ContextMenu.Sub key={key}>
          <ContextMenu.SubTrigger>
            {action.icon}
            {action.label}
          </ContextMenu.SubTrigger>
          <ContextMenu.SubContent>
            {action.children.map((child, childKey) =>
              renderAction(child, childKey),
            )}
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
      )
    case 'item':
      return (
        <ContextMenu.Item
          key={key}
          color={action.color}
          shortcut={action.shortcut}
          disabled={action.disabled}
          onSelect={action.onSelect}
        >
          {action.icon}
          {action.label}
        </ContextMenu.Item>
      )
  }
}
