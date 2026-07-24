import type React from 'react'
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useWorkspaceHeaderContext } from './WorkspaceHeaderProvider.js'
import {
  selectWorkspaceHeaderItems,
  type WorkspaceHeaderItemSnapshot,
  type WorkspaceHeaderSlot,
} from './workspaceHeaderStore.js'

export type DesktopWorkspaceHeaderProps = {
  className?: string
  fullWidth: boolean
  rightDockOpen: boolean
  shellControls: React.ReactNode
}

type HeaderSideWidths = {
  left: number
  right: number
}

const EMPTY_WIDTHS: HeaderSideWidths = { left: 0, right: 0 }

export function DesktopWorkspaceHeader({
  className,
  fullWidth,
  rightDockOpen,
  shellControls,
}: DesktopWorkspaceHeaderProps): React.ReactNode {
  const { routeScope, store } = useWorkspaceHeaderContext()
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  )
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRouteRef = useRef<HTMLDivElement>(null)
  const shellControlsRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState<HeaderSideWidths>(EMPTY_WIDTHS)
  const routeItems = useMemo(
    () =>
      fullWidth
        ? []
        : selectWorkspaceHeaderItems(snapshot, routeScope),
    [fullWidth, routeScope, snapshot],
  )

  useLayoutEffect(() => {
    const left = leftRef.current
    const rightRoute = rightRouteRef.current
    const shell = shellControlsRef.current
    if (!left || !rightRoute || !shell) return

    const workspace = shell.closest<HTMLElement>('.desktop-workspace')
    let appliedShellWidth = ''

    const update = (): void => {
      const next = {
        left: Math.max(0, left.getBoundingClientRect().width),
        right: Math.max(0, rightRoute.getBoundingClientRect().width),
      }
      setWidths(current =>
        current.left === next.left && current.right === next.right
          ? current
          : next,
      )

      if (workspace) {
        appliedShellWidth = `${Math.max(
          0,
          shell.getBoundingClientRect().width,
        )}px`
        workspace.style.setProperty(
          '--workspace-header-shell-width',
          appliedShellWidth,
        )
      }
    }
    update()

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(update)
    observer?.observe(left)
    observer?.observe(rightRoute)
    observer?.observe(shell)
    return () => {
      observer?.disconnect()
      if (
        workspace?.style.getPropertyValue('--workspace-header-shell-width') ===
        appliedShellWidth
      ) {
        workspace.style.removeProperty('--workspace-header-shell-width')
      }
    }
  }, [])

  const centerSafeInset = Math.max(widths.left, widths.right)
  const style = {
    '--workspace-header-left-width': `${widths.left}px`,
    '--workspace-header-right-width': `${widths.right}px`,
    '--workspace-header-center-safe-inset': `${centerSafeInset}px`,
  } as React.CSSProperties

  return (
    <header
      className={['desktop-workspace-header', className]
        .filter(Boolean)
        .join(' ')}
      data-full-width={fullWidth || undefined}
      data-right-dock-open={rightDockOpen || undefined}
      aria-label="工作区工具栏"
      role="toolbar"
      style={style}
    >
      <div className="desktop-workspace-header-route-band">
        <div className="desktop-workspace-header-route-left" ref={leftRef}>
          <HeaderSlot items={routeItems} slot="left" />
        </div>
        <div className="desktop-workspace-header-center">
          <HeaderSlot items={routeItems} slot="center" />
        </div>
        <div className="desktop-workspace-header-route-right" ref={rightRouteRef}>
          <HeaderSlot items={routeItems} slot="right" />
        </div>
      </div>
      <div className="desktop-workspace-header-shell-controls" ref={shellControlsRef}>
        {shellControls}
      </div>
    </header>
  )
}

function HeaderSlot({
  items,
  slot,
}: {
  items: readonly WorkspaceHeaderItemSnapshot[]
  slot: WorkspaceHeaderSlot
}): React.ReactNode {
  const slotItems = items.filter(item => item.slot === slot)
  return (['start', 'center', 'end'] as const).map(align => {
    const alignedItems = slotItems.filter(item => item.align === align)
    if (alignedItems.length === 0) return null
    return (
      <div className="desktop-workspace-header-group" data-align={align} key={align}>
        {alignedItems.map(item => (
          <div
            className="desktop-workspace-header-item"
            key={`${item.routeScope}:${item.id}`}
          >
            {item.node}
          </div>
        ))}
      </div>
    )
  })
}
