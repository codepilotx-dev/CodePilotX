import type React from 'react'
import {
  AnimatePresence,
  animate as animateMotionValue,
  motion,
  usePresence,
  useMotionValueEvent,
} from 'motion/react'
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'
import {
  exitTween,
  instantTween,
  layoutTween,
  motionTransition,
} from '../../motion/motionTransitions.js'
import type { WorkbenchPanelTarget } from '../dock/rightDockState.js'
import type { LiveResizeValue } from '../useLiveResizeValue.js'
import type { ResizePhase } from '../useSidebarResizeCollapseConfirm.js'

type Props = {
  children: React.ReactNode
  fullWidth?: boolean
  liveResize: LiveResizeValue
  mainRouteRef: React.RefObject<HTMLDivElement | null>
  workspaceRef: React.RefObject<HTMLDivElement | null>
  minSize: number
  size: number
  target: WorkbenchPanelTarget
  visible: boolean
  onResizePhaseChange?: (phase: ResizePhase) => void
}

export type WorkbenchPanelLiveResize = LiveResizeValue & {
  committedSize: number
  phase: ResizePhase
  previewSize: (nextSize: number | null) => void
  setPhase: (phase: ResizePhase) => void
  target: WorkbenchPanelTarget
}

const WorkbenchPanelResizePreviewContext =
  createContext<WorkbenchPanelLiveResize | null>(null)

export function useWorkbenchPanelLiveResize(
  target: WorkbenchPanelTarget,
): WorkbenchPanelLiveResize | null {
  const context = useContext(WorkbenchPanelResizePreviewContext)
  return context?.target === target ? context : null
}

export function WorkbenchPanelPresence({
  children,
  fullWidth = false,
  liveResize,
  mainRouteRef,
  workspaceRef,
  minSize,
  size,
  target,
  visible,
  onResizePhaseChange,
}: Props): React.ReactNode {
  const initiallyVisibleRef = useRef(visible)

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <WorkbenchPanelPresenceItem
          key={target}
          fullWidth={fullWidth}
          liveResize={liveResize}
          mainRouteRef={mainRouteRef}
          workspaceRef={workspaceRef}
          minSize={minSize}
          size={size}
          skipEnterAnimation={initiallyVisibleRef.current}
          target={target}
          onResizePhaseChange={onResizePhaseChange}
        >
          {children}
        </WorkbenchPanelPresenceItem>
      ) : null}
    </AnimatePresence>
  )
}

function WorkbenchPanelPresenceItem({
  children,
  fullWidth,
  liveResize,
  mainRouteRef,
  workspaceRef,
  minSize,
  size,
  skipEnterAnimation,
  target,
  onResizePhaseChange,
}: Omit<Props, 'visible'> & {
  skipEnterAnimation: boolean
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [isPresent, safeToRemove] = usePresence()
  const shellRef = useRef<HTMLDivElement>(null)
  const [entryComplete, setEntryComplete] = useState(skipEnterAnimation)
  const [resizePhase, setResizePhase] = useState<ResizePhase>('idle')
  const isBottom = target === 'bottom'
  const { liveSize, liveSizePixels, previewSize } = liveResize

  useMotionValueEvent(liveSizePixels, 'change', nextSize => {
    if (target !== 'right') return
    workspaceRef.current?.style.setProperty(
      '--workspace-right-panel-live-width',
      nextSize,
    )
  })

  const updateResizePhase = useCallback((phase: ResizePhase): void => {
    setResizePhase(current => current === phase ? current : phase)
    onResizePhaseChange?.(phase)
  }, [onResizePhaseChange])
  const resizePreviewContext = useMemo<WorkbenchPanelLiveResize>(
    () => ({
      committedSize: size,
      liveSize,
      liveSizePixels,
      phase: resizePhase,
      previewSize,
      setPhase: updateResizePhase,
      target,
    }),
    [
      liveSize,
      liveSizePixels,
      previewSize,
      resizePhase,
      size,
      target,
      updateResizePhase,
    ],
  )
  const visibleState = isBottom
    ? { height: size, opacity: 1, y: 0 }
    : { opacity: 1, x: 0 }
  const hiddenState = isBottom
    ? { height: 0, opacity: 0, y: 8 }
    : { opacity: 0, x: 8 }
  const spacerVisibleState = { height: size }
  const spacerHiddenState = { height: 0 }
  const enforcedMinSize = isPresent && entryComplete ? minSize : 0
  const liveSizeStyle = isBottom
    ? { height: liveSize, minHeight: enforcedMinSize }
    : { minWidth: enforcedMinSize, width: liveSize }

  useLayoutEffect(() => {
    if (target === 'right') {
      workspaceRef.current?.style.setProperty(
        '--workspace-right-panel-live-width',
        `${liveSize.get()}px`,
      )
    }
    return () => {
      if (target === 'right') {
        workspaceRef.current?.style.removeProperty(
          '--workspace-right-panel-live-width',
        )
      }
    }
  }, [liveSize, target, workspaceRef])

  useLayoutEffect(() => {
    if (target !== 'right') return
    if (!isPresent) {
      const controls = animateMotionValue(
        liveSize,
        0,
        motionTransition(reducedMotion, exitTween),
      )
      return () => controls.stop()
    }
    if (entryComplete) return
    if (skipEnterAnimation) {
      liveSize.set(size)
      return
    }
    liveSize.set(0)
    const controls = animateMotionValue(
      liveSize,
      size,
      motionTransition(reducedMotion, layoutTween),
    )
    return () => controls.stop()
  }, [
    entryComplete,
    isPresent,
    liveSize,
    reducedMotion,
    size,
    skipEnterAnimation,
    target,
  ])

  useLayoutEffect(() => {
    if (isPresent) return
    setEntryComplete(false)
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement
      && shellRef.current?.contains(activeElement)
    ) {
      mainRouteRef.current?.focus({ preventScroll: true })
    }
  }, [isPresent, mainRouteRef])

  useEffect(() => () => {
    onResizePhaseChange?.('idle')
  }, [onResizePhaseChange])

  useEffect(() => {
    if (!reducedMotion || !isPresent) return
    setEntryComplete(true)
  }, [isPresent, reducedMotion])

  useEffect(() => {
    if (isPresent || !safeToRemove) return
    const timeout = window.setTimeout(
      safeToRemove,
      reducedMotion ? 0 : (exitTween.duration as number) * 1_000,
    )
    return () => window.clearTimeout(timeout)
  }, [isPresent, reducedMotion, safeToRemove])

  return (
    <WorkbenchPanelResizePreviewContext.Provider value={resizePreviewContext}>
      {isBottom ? (
        <motion.div
          aria-hidden="true"
          animate={isPresent
            ? spacerVisibleState
            : {
                ...spacerHiddenState,
                transition: motionTransition(reducedMotion, exitTween),
              }}
          className="desktop-workspace-panel-spacer desktop-workspace-panel-spacer--bottom"
          initial={skipEnterAnimation ? false : spacerHiddenState}
          style={liveSizeStyle}
          transition={motionTransition(
            reducedMotion,
            entryComplete ? instantTween : layoutTween,
          )}
        />
      ) : null}
      <motion.div
        ref={shellRef}
        aria-hidden={!isPresent ? true : undefined}
        animate={isPresent
          ? visibleState
          : {
              ...hiddenState,
              transition: motionTransition(reducedMotion, exitTween),
            }}
        className={[
          'desktop-workspace-panel',
          `desktop-workspace-panel--${target === 'right' ? 'right' : 'bottom'}`,
          fullWidth ? 'full-width' : '',
        ].filter(Boolean).join(' ')}
        data-workbench-panel-presence={isPresent ? 'open' : 'exiting'}
        initial={skipEnterAnimation ? false : hiddenState}
        inert={!isPresent ? true : undefined}
        onAnimationComplete={() => {
          if (isPresent) setEntryComplete(true)
        }}
        style={liveSizeStyle}
        transition={motionTransition(
          reducedMotion,
          entryComplete ? instantTween : layoutTween,
        )}
      >
        <div className="desktop-workspace-panel__surface">
          {children}
        </div>
      </motion.div>
    </WorkbenchPanelResizePreviewContext.Provider>
  )
}
