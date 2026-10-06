import { forwardRef } from 'react'
import type React from 'react'
import { motion, type MotionValue } from 'motion/react'
import { cx } from '../../../utils/cx.js'
import type { WorkbenchPanelTarget } from './rightDockState.js'

export interface WorkbenchDockFrameProps {
  target: WorkbenchPanelTarget
  open: boolean
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
export const WorkbenchDockFrame = forwardRef<HTMLElement, WorkbenchDockFrameProps>(
  function WorkbenchDockFrame(
    { target, open, targetWidth, visibleWidth, children, className },
    ref,
  ): React.ReactNode {
    return (
      <motion.aside
        ref={ref}
        aria-label={target === 'right' ? '右侧面板' : '底部面板'}
        aria-hidden={!open || undefined}
        className={cx(
          target === 'right'
            ? 'right-dock tw:border-l tw:border-app-border tw:forced-colors:border-l-[CanvasText]'
            : 'bottom-panel tw:border-t tw:border-app-border tw:forced-colors:border-t-[CanvasText]',
          'workbench-panel tw:relative tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden tw:rounded-none tw:bg-app-dock tw:text-app-text tw:shadow-none',
          className,
        )}
        data-app-shell-focus-area={`${target}-panel`}
        data-workbench-panel-open={open || undefined}
        data-workbench-panel-target={target}
        style={{
          width: target === 'right' ? visibleWidth : '100%',
        }}
      >
        <motion.div
          className="workbench-dock-frame__target tw:relative tw:flex tw:h-full tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden"
          style={{
            width: target === 'right' ? targetWidth : '100%',
          }}
        >
          {children}
        </motion.div>
      </motion.aside>
    )
  },
)
