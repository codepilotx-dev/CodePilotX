import type React from 'react'
import { useEffect, useRef } from 'react'

type Props = {
  children: React.ReactNode
  className?: string
  open: boolean
  trigger: React.ReactNode
  onOpenChange: (open: boolean) => void
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
    if (!open) return

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target
      if (
        target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(target)
      ) {
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
        onOpenChange(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
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