import { forwardRef } from 'react'
import type React from 'react'
import type {
  WorkbenchFocusArea,
  WorkbenchPanelTarget,
} from './rightDockState.js'

export interface WorkbenchDockFrameProps {
  target: WorkbenchPanelTarget
  open: boolean
  fullWidth: boolean
  width: number
  animatedWidth: number
  opacity: number
  focusArea: WorkbenchFocusArea
  children: React.ReactNode
  className?: string
}

/**
 * Stable App Shell frame for right and bottom workbench panels.
 *
 * Panel geometry is animated by the shell presence controller. Keeping that
 * geometry on the frame while the inner surface remains at its target size
 * prevents tab and document content from reflowing throughout the transition.
 */
export const WorkbenchDockFrame = forwardRef<
  HTMLElement,
  WorkbenchDockFrameProps
>(function WorkbenchDockFrame(
  {
    target,
    open,
    fullWidth,
    width,
    animatedWidth,
    opacity,
    focusArea,
    children,
    className,
  },
  ref,
): React.ReactNode {
  return (
    <aside
      ref={ref}
      aria-label={target === 'right' ? '右侧面板' : '底部面板'}
      aria-hidden={!open || undefined}
      className={[
        target === 'right' ? 'right-dock' : 'bottom-panel',
        'workbench-panel',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-app-shell-focus-area={`${target}-panel`}
      data-workbench-panel-focus-context={focusArea}
      data-workbench-panel-full-width={fullWidth || undefined}
      data-workbench-panel-open={open || undefined}
      data-workbench-panel-target={target}
      style={
        {
          '--workbench-panel-animated-width':
            target === 'right' && !fullWidth ? `${animatedWidth}px` : '100%',
          '--workbench-panel-opacity': opacity,
          '--workbench-panel-target-width':
            target === 'right' && !fullWidth ? `${width}px` : '100%',
        } as React.CSSProperties
      }
    >
      {children}
    </aside>
  )
})
