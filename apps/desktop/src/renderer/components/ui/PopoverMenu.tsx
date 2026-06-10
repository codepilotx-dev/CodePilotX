import type React from 'react'
import { useEffect, useRef } from 'react'

type Props = {
  children: React.ReactNode
  className?: string
  open: boolean
  trigger: React.ReactNode
  autoWidth?: boolean
  textMode?: 'nowrap' | 'wrap'
  onOpenChange: (open: boolean) => void
}

export function PopoverMenu({
  children,
  className = '',
  open,
  trigger,
  autoWidth = false,
  textMode = 'nowrap',
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
        <div
          className={[
            'popover',
            className,
            autoWidth ? 'popover-auto-width' : '',
            textMode === 'wrap' ? 'popover-text-wrap' : '',
          ].join(' ')}
          role="menu"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
