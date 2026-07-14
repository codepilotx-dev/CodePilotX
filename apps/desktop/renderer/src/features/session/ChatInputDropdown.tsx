import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../components/ui/popoverSizing.js'

type Props = {
  open: boolean
  onClose: () => void
  disableOutsideDismiss?: boolean
  side?: 'top' | 'bottom'
  children: React.ReactNode
} & PopoverSizingProps

type ShouldCloseChatInputDropdownOptions = {
  disableOutsideDismiss?: boolean
}

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
  { disableOutsideDismiss = false }: ShouldCloseChatInputDropdownOptions = {},
): boolean {
  if (disableOutsideDismiss) return false
  const composerTop = target.closest('.composer-top')
  const dropdown = target.closest('.chat-input__dropdown')
  return !composerTop && !dropdown
}

export function ChatInputDropdown({
  open,
  onClose,
  disableOutsideDismiss = false,
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
      if (
        shouldCloseChatInputDropdownForClick(target, {
          disableOutsideDismiss,
        })
      ) {
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
  }, [disableOutsideDismiss, open, onClose])

  if (!open) return null

  const style: React.CSSProperties = buildPopoverSizingStyle({ width, maxWidth })
  if (maxHeight !== null) {
    style.maxHeight = `${maxHeight}px`
    style.overflowY = 'auto'
    style.overflowX = 'hidden'
  }

  return (
    <div
      ref={ref}
      className={[
        'popover-surface',
        'chat-input__dropdown',
        side === 'bottom' ? 'chat-input__dropdown--bottom' : '',
      ].join(' ')}
      onClick={e => e.stopPropagation()}
      style={style}
    >
      <div className="chat-input__dropdown-content">{children}</div>
    </div>
  )
}
