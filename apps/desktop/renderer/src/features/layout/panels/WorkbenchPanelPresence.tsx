import type React from 'react'
import {
  AnimatePresence,
  motion,
  usePresence,
} from 'motion/react'
import {
  createContext,
  useContext,
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
import { useLiveResizeValue } from '../useLiveResizeValue.js'

type Props = {
  children: React.ReactNode
  fullWidth?: boolean
  mainRouteRef: React.RefObject<HTMLDivElement | null>
  minSize: number
  size: number
  target: WorkbenchPanelTarget
  visible: boolean
}

type WorkbenchPanelResizePreviewContextValue = {
  previewSize: (nextSize: number | null) => void
  target: WorkbenchPanelTarget
}

const WorkbenchPanelResizePreviewContext =
  createContext<WorkbenchPanelResizePreviewContextValue | null>(null)

export function useWorkbenchPanelResizePreview(
  target: WorkbenchPanelTarget,
): ((nextSize: number | null) => void) | null {
  const context = useContext(WorkbenchPanelResizePreviewContext)
  return context?.target === target ? context.previewSize : null
}

export function WorkbenchPanelPresence({
  children,
  fullWidth = false,
  mainRouteRef,
  minSize,
  size,
  target,
  visible,
}: Props): React.ReactNode {
  const initiallyVisibleRef = useRef(visible)

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <WorkbenchPanelPresenceItem
          key={target}
          fullWidth={fullWidth}
          mainRouteRef={mainRouteRef}
          minSize={minSize}
          size={size}
          skipEnterAnimation={initiallyVisibleRef.current}
          target={target}
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
  mainRouteRef,
  minSize,
  size,
  skipEnterAnimation,
  target,
}: Omit<Props, 'visible'> & {
  skipEnterAnimation: boolean
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [isPresent, safeToRemove] = usePresence()
  const shellRef = useRef<HTMLDivElement>(null)
  const [entryComplete, setEntryComplete] = useState(skipEnterAnimation)
  const isBottom = target === 'bottom'
  const { liveSize, previewSize } = useLiveResizeValue(size)

  const resizePreviewContext = useMemo(
    () => ({ previewSize, target }),
    [previewSize, target],
  )
  const visibleState = isBottom
    ? { height: size, opacity: 1, y: 0 }
    : { opacity: 1, width: size, x: 0 }
  const hiddenState = isBottom
    ? { height: 0, opacity: 0, y: 8 }
    : { opacity: 0, width: 0, x: 8 }
  const spacerVisibleState = isBottom ? { height: size } : { width: size }
  const spacerHiddenState = isBottom ? { height: 0 } : { width: 0 }
  const enforcedMinSize = isPresent && entryComplete ? minSize : 0
  const liveSizeStyle = isBottom
    ? { height: liveSize, minHeight: enforcedMinSize }
    : { minWidth: enforcedMinSize, width: liveSize }

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
      <motion.div
        aria-hidden="true"
        animate={isPresent
          ? spacerVisibleState
          : {
              ...spacerHiddenState,
              transition: motionTransition(reducedMotion, exitTween),
            }}
        className={[
          'desktop-workspace-panel-spacer',
          `desktop-workspace-panel-spacer--${target === 'right' ? 'right' : 'bottom'}`,
          fullWidth ? 'full-width' : '',
        ].filter(Boolean).join(' ')}
        initial={skipEnterAnimation ? false : spacerHiddenState}
        style={liveSizeStyle}
        transition={motionTransition(
          reducedMotion,
          entryComplete ? instantTween : layoutTween,
        )}
      />
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
