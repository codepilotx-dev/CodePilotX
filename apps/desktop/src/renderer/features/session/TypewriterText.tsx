import React from 'react'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'

type TypewriterTextProps = {
  enabled?: boolean
  speed?: number
  text: string
}

const DEFAULT_SPEED = 180

export function TypewriterText({
  enabled = true,
  speed = DEFAULT_SPEED,
  text,
}: TypewriterTextProps): React.ReactNode {
  const displayed = useTypewriterText({ enabled, speed, text })
  return <>{displayed}</>
}

export function useTypewriterText({
  enabled = true,
  speed = DEFAULT_SPEED,
  text,
}: TypewriterTextProps): string {
  const reducedMotion = usePrefersReducedMotion()
  const [displayed, setDisplayed] = React.useState(enabled ? '' : text)

  React.useEffect(() => {
    if (!enabled || reducedMotion || !text) {
      setDisplayed(text)
      return
    }

    let cancelled = false
    let frame = 0
    const startedAt = performance.now()
    setDisplayed('')

    function tick(now: number): void {
      if (cancelled) return
      const elapsedSeconds = Math.max(0, (now - startedAt) / 1000)
      const nextLength = Math.min(text.length, Math.ceil(elapsedSeconds * speed))
      setDisplayed(text.slice(0, nextLength))
      if (nextLength < text.length) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [enabled, reducedMotion, speed, text])

  return displayed
}

