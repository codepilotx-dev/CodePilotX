import { forwardRef } from 'react'
import type React from 'react'
import { motion, type MotionValue } from 'motion/react'
import type {
  WorkbenchPanelTarget,
} from './rightDockState.js'

export interface WorkbenchDockFrameProps {
  target: WorkbenchPanelTarget
  open: boolean
  fullWidth: boolean
  targetWidth: MotionValue<number> | number | string
  visibleWidth: MotionValue<number> | number | string
  children: React.ReactNode
  className?: string
}

/**
 * Stable App Shell frame for right and bottom workbench panels.
 *
 * `visibleWidth` follows the shell edge. `targetWidth` stays stable while the
 * panel enters/exits, but follows the same live value during pointer resize.
 */
export const WorkbenchDockFrame = forwardRef<
  HTMLElement,
  WorkbenchDockFrameProps
>(function WorkbenchDockFrame(
  {
    target,
    open,
    fullWidth,
    targetWidth,
    visibleWidth,
    children,
    className,
  },
  ref,
): React.ReactNode {
  return (
    <motion.aside
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
      data-workbench-panel-full-width={fullWidth || undefined}
      data-workbench-panel-open={open || undefined}
      data-workbench-panel-target={target}
      style={{
        width: target === 'right' && !fullWidth ? visibleWidth : '100%',
      }}
    >
      <motion.div
        className="workbench-dock-frame__target"
        style={{
          width: target === 'right' && !fullWidth ? targetWidth : '100%',
        }}
      >
        {children}
      </motion.div>
    </motion.aside>
  )
})
