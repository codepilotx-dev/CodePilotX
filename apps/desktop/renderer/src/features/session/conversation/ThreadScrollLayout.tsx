import React from 'react'

import {
  distanceFromThreadBottom,
  scrollOffsetForThreadBottomDistance,
} from './useThreadScrollController.js'

export type ThreadScrollLayoutProps = {
  children: React.ReactNode
  footer: React.ReactNode
  scrollRef: React.RefObject<HTMLDivElement | null>
  footerRef: React.RefObject<HTMLElement | null>
  className?: string
}

const THREAD_FOOTER_GAP_PX = 16

/**
 * Owns the thread's only scrolling element and its sticky footer.
 *
 * The footer remains in normal flow, so the last virtualized row is never
 * covered by the composer. Its measured height is also exposed as a scroll
 * padding token for focus navigation and imperative scrolling.
 */
export function ThreadScrollLayout({
  children,
  footer,
  scrollRef,
  footerRef,
  className,
}: ThreadScrollLayoutProps): React.ReactNode {
  const measuredInsetRef = React.useRef(THREAD_FOOTER_GAP_PX)
  const previousFooterHeightRef = React.useRef(0)
  const previousViewportHeightRef = React.useRef(0)
  const writtenInsetRef = React.useRef<string | null>(null)

  const writeMeasuredInset = React.useCallback(
    (focusWithin: boolean): void => {
      const value = focusWithin ? '0px' : `${measuredInsetRef.current}px`
      if (writtenInsetRef.current === value) return
      writtenInsetRef.current = value
      scrollRef.current?.style.setProperty('--thread-scroll-padding-bottom', value)
    },
    [scrollRef],
  )

  React.useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    const footerElement = footerRef.current
    if (!scrollElement || !footerElement) return
    writtenInsetRef.current = null

    let measureFrame: number | null = null
    let observedFooterHeight: number | null = null
    let observedViewportHeight: number | null = null

    const measureLayout = (): void => {
      measureFrame = null
      const footerHeight = Math.ceil(
        observedFooterHeight ?? footerElement.getBoundingClientRect().height,
      )
      const viewportHeight = Math.ceil(
        observedViewportHeight ?? scrollElement.clientHeight,
      )
      observedFooterHeight = null
      observedViewportHeight = null
      const previousFooterHeight = previousFooterHeightRef.current
      const footerHeightDelta = footerHeight - previousFooterHeight
      const scrollSize = scrollElement.scrollHeight
      const previousDistance = Math.max(
        0,
        distanceFromThreadBottom({
          scrollOffset: scrollElement.scrollTop,
          scrollSize,
          viewportSize: viewportHeight,
        }) - footerHeightDelta,
      )
      previousFooterHeightRef.current = footerHeight
      measuredInsetRef.current = footerHeight + THREAD_FOOTER_GAP_PX
      if (previousViewportHeightRef.current !== viewportHeight) {
        previousViewportHeightRef.current = viewportHeight
        scrollElement.style.setProperty(
          '--thread-scroll-viewport-height',
          `${viewportHeight}px`,
        )
      }
      writeMeasuredInset(footerElement.contains(document.activeElement))

      if (previousFooterHeight === 0 || previousFooterHeight === footerHeight) {
        return
      }

      scrollElement.scrollTop = scrollOffsetForThreadBottomDistance(
        { scrollSize, viewportSize: viewportHeight },
        previousDistance,
      )
    }

    const scheduleMeasure = (entries: ResizeObserverEntry[]): void => {
      for (const entry of entries) {
        const blockSize =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        if (entry.target === footerElement) observedFooterHeight = blockSize
        if (entry.target === scrollElement) observedViewportHeight = blockSize
      }
      if (measureFrame !== null) return
      measureFrame = requestAnimationFrame(measureLayout)
    }

    measureLayout()
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleMeasure)
    observer?.observe(footerElement)
    observer?.observe(scrollElement)

    return () => {
      observer?.disconnect()
      if (measureFrame !== null) cancelAnimationFrame(measureFrame)
    }
  }, [footer, footerRef, scrollRef, writeMeasuredInset])

  const handleFooterFocusCapture = React.useCallback((): void => {
    writeMeasuredInset(true)
  }, [writeMeasuredInset])

  const handleFooterBlurCapture = React.useCallback((): void => {
    requestAnimationFrame(() => {
      const stillFocused = footerRef.current?.contains(document.activeElement)
      writeMeasuredInset(Boolean(stillFocused))
    })
  }, [footerRef, writeMeasuredInset])

  return (
    <div
      ref={scrollRef}
      className={['thread-scroll-layout', className].filter(Boolean).join(' ')}
      data-component="thread-scroll-layout"
    >
      <div className="thread-scroll-layout__inner">
        <div className="thread-scroll-layout__content">{children}</div>
        {footer ? (
          <footer
            ref={footerRef}
            className="thread-scroll-layout__footer"
            onFocusCapture={handleFooterFocusCapture}
            onBlurCapture={handleFooterBlurCapture}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
