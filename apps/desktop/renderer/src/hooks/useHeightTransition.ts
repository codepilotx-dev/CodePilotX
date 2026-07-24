import React from 'react'

const HEIGHT_TRANSITION_MS = 240

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

    const startHeight = previousHeight.current ?? el.getBoundingClientRect().height
    const targetHeight = outerContentHeight(el)
    previousHeight.current = targetHeight

    if (Math.abs(startHeight - targetHeight) < 1) {
      setHeight(null)
      setTransitioning(false)
      return
    }

    let frame = 0
    let timer = 0
    setHeight(startHeight)
    setTransitioning(true)

    frame = window.requestAnimationFrame(() => {
      setHeight(targetHeight)
      timer = window.setTimeout(() => {
        setHeight(null)
        setTransitioning(false)
      }, HEIGHT_TRANSITION_MS)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
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

function outerContentHeight(el: HTMLElement): number {
  const style = window.getComputedStyle(el)
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0
  const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0
  if (style.boxSizing === 'border-box') {
    return el.scrollHeight + borderTop + borderBottom
  }
  return el.scrollHeight
}
