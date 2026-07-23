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
  const correctionFrameRef = React.useRef<number | null>(null)

  const writeMeasuredInset = React.useCallback(
    (focusWithin: boolean): void => {
      scrollRef.current?.style.setProperty(
        '--thread-scroll-padding-bottom',
        focusWithin ? '0px' : `${measuredInsetRef.current}px`,
      )
    },
    [scrollRef],
  )

  React.useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    const footerElement = footerRef.current
    if (!scrollElement || !footerElement) return

    const readDistance = (): number =>
      distanceFromThreadBottom({
        scrollOffset: scrollElement.scrollTop,
        scrollSize: scrollElement.scrollHeight,
        viewportSize: scrollElement.clientHeight,
      })

    const measureFooter = (): void => {
      const footerHeight = Math.ceil(footerElement.getBoundingClientRect().height)
      const previousFooterHeight = previousFooterHeightRef.current
      const footerHeightDelta = footerHeight - previousFooterHeight
      const previousDistance = Math.max(0, readDistance() - footerHeightDelta)
      previousFooterHeightRef.current = footerHeight
      measuredInsetRef.current = footerHeight + THREAD_FOOTER_GAP_PX
      scrollElement.style.setProperty(
        '--thread-scroll-viewport-height',
        `${scrollElement.clientHeight}px`,
      )
      writeMeasuredInset(footerElement.contains(document.activeElement))

      if (previousFooterHeight === 0 || previousFooterHeight === footerHeight) {
        return
      }

      if (correctionFrameRef.current !== null) {
        cancelAnimationFrame(correctionFrameRef.current)
      }
      correctionFrameRef.current = requestAnimationFrame(() => {
        correctionFrameRef.current = null
        scrollElement.scrollTop = scrollOffsetForThreadBottomDistance(
          {
            scrollSize: scrollElement.scrollHeight,
            viewportSize: scrollElement.clientHeight,
          },
          previousDistance,
        )
      })
    }

    measureFooter()
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measureFooter)
    observer?.observe(footerElement)
    observer?.observe(scrollElement)

    return () => {
      observer?.disconnect()
      if (correctionFrameRef.current !== null) {
        cancelAnimationFrame(correctionFrameRef.current)
      }
    }
  }, [footerRef, scrollRef, writeMeasuredInset])

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
        <footer
          ref={footerRef}
          className="thread-scroll-layout__footer"
          onFocusCapture={handleFooterFocusCapture}
          onBlurCapture={handleFooterBlurCapture}
        >
          {footer}
        </footer>
      </div>
    </div>
  )
}
