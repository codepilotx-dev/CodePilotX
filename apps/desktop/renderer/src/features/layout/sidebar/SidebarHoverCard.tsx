import type React from 'react'
import { cloneElement, useCallback, useEffect, useId, useRef } from 'react'
import { AnimatePresence } from 'motion/react'

export type SidebarHoverCardOverlayRenderProps = {
  anchorRef: React.RefObject<HTMLElement | null>
  closeAfterDelay: () => void
  contentId: string
  keepOpen: () => void
  returnFocusToAnchor: () => void
  requestOpenChange: (open: boolean) => void
}

type AnchorProps = React.HTMLAttributes<HTMLElement>
  & React.RefAttributes<HTMLElement>

type Props = {
  children: React.ReactElement<AnchorProps>
  lockOpen?: boolean
  open: boolean
  onAnchorKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
  onOpenChange: (open: boolean) => void
  renderOverlay: (
    props: SidebarHoverCardOverlayRenderProps,
  ) => React.ReactNode
}

const CLOSE_DELAY_MS = 120

export function SidebarHoverCard({
  children,
  lockOpen = false,
  open,
  onAnchorKeyDown,
  onOpenChange,
  renderOverlay,
}: Props): React.ReactNode {
  const anchorRef = useRef<HTMLElement | null>(null)
  const contentId = useId()
  const closeTimerRef = useRef<number | null>(null)
  const childRef = children.props.ref
  const setAnchorRef = useCallback((node: HTMLElement | null): void => {
    anchorRef.current = node
    assignRef(childRef, node)
  }, [childRef])

  useEffect(
    () => () => {
      clearTimer(closeTimerRef)
    },
    [],
  )

  function requestOpenChange(nextOpen: boolean): void {
    if (lockOpen && !nextOpen) return
    onOpenChange(nextOpen)
  }

  function keepOpen(): void {
    clearTimer(closeTimerRef)
  }

  function openImmediately(): void {
    keepOpen()
    onOpenChange(true)
  }

  function closeAfterDelay(): void {
    if (lockOpen) return
    clearTimer(closeTimerRef)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      onOpenChange(false)
    }, CLOSE_DELAY_MS)
  }

  function returnFocusToAnchor(): void {
    requestAnimationFrame(() => {
      focusSidebarHoverCardAnchor(anchorRef.current)
    })
  }

  const anchor = cloneElement(children, {
    ref: setAnchorRef,
    'aria-controls': open ? contentId : undefined,
    'aria-expanded': open,
    'aria-haspopup': 'dialog',
    onBlur: event => {
      children.props.onBlur?.(event)
      if (!event.defaultPrevented) closeAfterDelay()
    },
    onFocus: event => {
      children.props.onFocus?.(event)
      if (event.defaultPrevented) return
      if (event.currentTarget.dataset.sidebarSuppressHoverOpen === 'true') {
        delete event.currentTarget.dataset.sidebarSuppressHoverOpen
        return
      }
      keepOpen()
      onOpenChange(true)
    },
    onKeyDown: event => {
      children.props.onKeyDown?.(event)
      if (!event.defaultPrevented) onAnchorKeyDown?.(event)
    },
    onPointerEnter: event => {
      children.props.onPointerEnter?.(event)
      if (!event.defaultPrevented) openImmediately()
    },
    onPointerLeave: event => {
      children.props.onPointerLeave?.(event)
      if (!event.defaultPrevented) closeAfterDelay()
    },
  })

  return (
    <>
      {anchor}
      <AnimatePresence initial={false}>
        {open ? (
          <SidebarHoverCardOverlayPresence key="sidebar-hover-card-overlay">
            {renderOverlay({
              anchorRef,
              closeAfterDelay,
              contentId,
              keepOpen,
              returnFocusToAnchor,
              requestOpenChange,
            })}
          </SidebarHoverCardOverlayPresence>
        ) : null}
      </AnimatePresence>
    </>
  )
}

function SidebarHoverCardOverlayPresence({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return children
}

export function focusSidebarHoverCardAnchor(
  anchor: HTMLElement | null,
): void {
  if (!anchor || document.activeElement === anchor) return
  anchor.dataset.sidebarSuppressHoverOpen = 'true'
  anchor.focus()
  delete anchor.dataset.sidebarSuppressHoverOpen
}

function assignRef(
  ref: React.Ref<HTMLElement> | undefined,
  node: HTMLElement | null,
): void {
  if (typeof ref === 'function') {
    ref(node)
  } else if (ref) {
    ref.current = node
  }
}

function clearTimer(timerRef: React.RefObject<number | null>): void {
  if (timerRef.current === null) return
  window.clearTimeout(timerRef.current)
  timerRef.current = null
}
