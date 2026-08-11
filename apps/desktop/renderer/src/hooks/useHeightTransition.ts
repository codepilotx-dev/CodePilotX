import React from 'react'

const HEIGHT_TRANSITION_MS = 200
const HEIGHT_TRANSITION_FALLBACK_MS = HEIGHT_TRANSITION_MS + 80

export function useHeightTransition(
  dependencies: React.DependencyList,
): {
  ref: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
} {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const previousHeight = React.useRef<number | null>(null)
  const [height, setHeight] = React.useState<number | null>(null)
  const [transitioning, setTransitioning] = React.useState(false)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const startHeight =
      height === null
        ? (previousHeight.current ?? el.getBoundingClientRect().height)
        : el.getBoundingClientRect().height
    const targetHeight = outerContentHeight(el)
    previousHeight.current = targetHeight

    if (
      Math.abs(startHeight - targetHeight) < 1 ||
      isReducedMotionEnabled()
    ) {
      setHeight(null)
      setTransitioning(false)
      return
    }

    let frame = 0
    let timer = 0
    let finished = false

    const finishTransition = (event?: TransitionEvent) => {
      if (
        finished ||
        (event && (event.target !== el || event.propertyName !== 'height'))
      ) {
        return
      }

      finished = true
      window.clearTimeout(timer)
      el.removeEventListener('transitionend', finishTransition)
      el.removeEventListener('transitioncancel', finishTransition)
      setHeight(null)
      setTransitioning(false)
    }

    setHeight(startHeight)
    setTransitioning(true)

    frame = window.requestAnimationFrame(() => {
      el.addEventListener('transitionend', finishTransition)
      el.addEventListener('transitioncancel', finishTransition)
      setHeight(targetHeight)
      timer = window.setTimeout(
        finishTransition,
        HEIGHT_TRANSITION_FALLBACK_MS,
      )
    })

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      el.removeEventListener('transitionend', finishTransition)
      el.removeEventListener('transitioncancel', finishTransition)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  return {
    ref,
    style: {
      height: height === null ? undefined : `${height}px`,
      overflow: transitioning ? 'hidden' : undefined,
    },
  }
}

function isReducedMotionEnabled(): boolean {
  return (
    document.documentElement.dataset.reduceMotion === 'on' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

function outerContentHeight(el: HTMLElement): number {
  const style = window.getComputedStyle(el)
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0
  const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0
  if (style.boxSizing === 'border-box') {
    return el.scrollHeight + borderTop + borderBottom
  }
  return el.scrollHeight
}
