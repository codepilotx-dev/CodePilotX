import type React from 'react'
import { useEffect, useRef } from 'react'

type Props = {
  children: React.ReactNode
  className?: string
  open: boolean
  trigger: React.ReactNode
  onOpenChange: (open: boolean) => void
}

function debugLog(message: string, payload?: unknown): void {
  const line = `[popover] ${message}`
  if (payload === undefined) {
    console.log(line)
  } else {
    console.log(line, payload)
  }
  if (
    typeof window !== 'undefined' &&
    window.desktopApi &&
    typeof window.desktopApi.logRenderer === 'function'
  ) {
    try {
      void window.desktopApi.logRenderer(line, payload)
    } catch {}
  }
}

export function PopoverMenu({
  children,
  className = '',
  open,
  trigger,
  onOpenChange,
}: Props): React.ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    debugLog('effect open', open)
    if (!open) return

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target
      debugLog('doc pointerdown', {
        tag: (target as Element).tagName,
        inside: target instanceof Node && rootRef.current
          ? rootRef.current.contains(target)
          : false,
      })
      if (
        target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(target)
      ) {
        debugLog('outside pointerdown -> close')
        onOpenChange(false)
      }
    }

    function handleMouseDown(event: MouseEvent): void {
      const target = event.target
      if (
        target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(target)
      ) {
        debugLog('outside mousedown -> close')
        onOpenChange(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        debugLog('escape -> close')
        onOpenChange(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onOpenChange, open])

  debugLog('render', { open, className })

  return (
    <div className="popover-root" ref={rootRef}>
      {trigger}
      {open ? (
        <div className={`popover ${className}`} role="menu">
          {children}
        </div>
      ) : null}
    </div>
  )
}
