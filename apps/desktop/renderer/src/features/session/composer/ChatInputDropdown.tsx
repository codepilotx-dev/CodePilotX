import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../../components/ui/popoverSizing.js'
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'
import {
  enterTween,
  exitTween,
  floatingSurfaceMotion,
  motionTransition,
} from '../../motion/motionTransitions.js'

type Props = {
  open: boolean
  onClose: () => void
  side?: 'top' | 'bottom'
  children: React.ReactNode
} & PopoverSizingProps

export type ComputeDropdownMaxHeightInput = {
  side: 'top' | 'bottom'
  anchorTop: number
  windowHeight: number
  maxCap: number
  safetyMargin: number
}

const DROPDOWN_MAX_CAP = 420
const DROPDOWN_SAFETY_MARGIN = 16

export function computeDropdownMaxHeight({
  side,
  anchorTop,
  windowHeight,
  maxCap,
  safetyMargin,
}: ComputeDropdownMaxHeightInput): number {
  const available =
    side === 'bottom'
      ? windowHeight - anchorTop - safetyMargin
      : anchorTop - safetyMargin
  return Math.max(0, Math.min(available, maxCap))
}

export function shouldCloseChatInputDropdownForClick(
  target: HTMLElement,
): boolean {
  const composerTop = target.closest('.composer-top')
  const dropdown = target.closest('.chat-input__dropdown')
  return !composerTop && !dropdown
}

export function ChatInputDropdown({
  open,
  onClose,
  side = 'top',
  width,
  maxWidth,
  children,
}: Props): React.ReactNode | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const measure = (): void => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const anchorTop = side === 'top' ? rect.bottom : rect.top
      setMaxHeight(
        computeDropdownMaxHeight({
          side,
          anchorTop,
          windowHeight: window.innerHeight,
          maxCap: DROPDOWN_MAX_CAP,
          safetyMargin: DROPDOWN_SAFETY_MARGIN,
        }),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [open, side])

  useEffect(() => {
    if (!open) return

    function onDocumentClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (shouldCloseChatInputDropdownForClick(target)) {
        onClose()
      }
    }

    function onEscKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('click', onDocumentClick, true)
    document.addEventListener('keydown', onEscKey)
    return () => {
      document.removeEventListener('click', onDocumentClick, true)
      document.removeEventListener('keydown', onEscKey)
    }
  }, [open, onClose])

  const style: React.CSSProperties = buildPopoverSizingStyle({ width, maxWidth })
  if (maxHeight !== null) {
    style.maxHeight = `${maxHeight}px`
    style.overflowY = 'auto'
    style.overflowX = 'hidden'
  }

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <ChatInputDropdownSurface
          key="chat-input-dropdown"
          maxHeightStyle={style}
          ref={ref}
          side={side}
        >
          {children}
        </ChatInputDropdownSurface>
      ) : null}
    </AnimatePresence>
  )
}

function ChatInputDropdownSurface({
  children,
  maxHeightStyle,
  ref,
  side,
}: {
  children: React.ReactNode
  maxHeightStyle: React.CSSProperties
  ref: React.Ref<HTMLDivElement>
  side: 'top' | 'bottom'
}): React.ReactNode {
  const isPresent = useIsPresent()
  const reducedMotion = usePrefersReducedMotion()
  const surfaceMotion = floatingSurfaceMotion(side)

  return (
    <motion.div
      animate={surfaceMotion.animate}
      aria-hidden={!isPresent ? true : undefined}
      className={[
        'popover-surface',
        'chat-input__dropdown',
        side === 'bottom' ? 'chat-input__dropdown--bottom' : '',
      ].join(' ')}
      data-presence={isPresent ? 'present' : 'exiting'}
      data-theme-component="dropdown-surface"
      exit={{
        ...surfaceMotion.exit,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={surfaceMotion.initial}
      onClick={event => event.stopPropagation()}
      ref={ref}
      style={{
        ...maxHeightStyle,
        pointerEvents: isPresent ? undefined : 'none',
      }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      <div className="chat-input__dropdown-content">{children}</div>
    </motion.div>
  )
}
