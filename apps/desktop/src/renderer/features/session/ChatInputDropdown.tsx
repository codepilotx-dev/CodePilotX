import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  side?: 'top' | 'bottom'
  children: React.ReactNode
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

export function ChatInputDropdown({
  open,
  onClose,
  side = 'top',
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
      const composerTop = target.closest('.composer-top')
      const dropdown = target.closest('.chat-input__dropdown')
      if (!composerTop && !dropdown) {
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

  if (!open) return null

  const style: React.CSSProperties = {}
  if (maxHeight !== null) {
    style.maxHeight = `${maxHeight}px`
    style.overflowY = 'auto'
  }

  return (
    <div
      ref={ref}
      className={[
        'chat-input__dropdown',
        side === 'bottom' ? 'chat-input__dropdown--bottom' : '',
      ].join(' ')}
      onClick={e => e.stopPropagation()}
      style={style}
    >
      {children}
    </div>
  )
}
