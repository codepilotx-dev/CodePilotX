import type React from 'react'
import {
  AnimatePresence,
  motion,
  useIsPresent,
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
  fastTween,
  instantTween,
  motionTransition,
  standardTween,
} from '../../motion/motionTransitions.js'
import type { WorkbenchPanelTarget } from '../dock/rightDockState.js'
import { useLiveResizeValue } from '../useLiveResizeValue.js'

type Props = {
  children: React.ReactNode
  fullWidth?: boolean
  mainRouteRef: React.RefObject<HTMLDivElement | null>
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
  size,
  skipEnterAnimation,
  target,
}: Omit<Props, 'visible'> & {
  skipEnterAnimation: boolean
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const isPresent = useIsPresent()
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

  return (
    <WorkbenchPanelResizePreviewContext.Provider value={resizePreviewContext}>
      <motion.div
        ref={shellRef}
        aria-hidden={!isPresent ? true : undefined}
        animate={visibleState}
        className={[
          'desktop-workspace-panel',
          `desktop-workspace-panel--${target === 'right' ? 'right' : 'bottom'}`,
          fullWidth ? 'full-width' : '',
        ].filter(Boolean).join(' ')}
        data-workbench-panel-presence={isPresent ? 'open' : 'exiting'}
        exit={{
          ...hiddenState,
          transition: motionTransition(reducedMotion, fastTween),
        }}
        initial={skipEnterAnimation ? false : hiddenState}
        inert={!isPresent ? true : undefined}
        onAnimationComplete={() => {
          if (isPresent) setEntryComplete(true)
        }}
        style={isBottom ? { height: liveSize } : { width: liveSize }}
        transition={motionTransition(
          reducedMotion,
          entryComplete ? instantTween : standardTween,
        )}
      >
        <motion.div
          className="desktop-workspace-panel__surface"
          style={isBottom
            ? { height: liveSize, minHeight: liveSize }
            : { minWidth: liveSize, width: liveSize }}
        >
          {children}
        </motion.div>
      </motion.div>
    </WorkbenchPanelResizePreviewContext.Provider>
  )
}
