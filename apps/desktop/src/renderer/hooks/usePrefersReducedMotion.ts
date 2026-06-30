import { useEffect, useState } from 'react'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(getEffectiveReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => {
      setReduced(getEffectiveReducedMotion())
    }
    const observer = new MutationObserver(update)
    update()
    media.addEventListener('change', update)
    observer.observe(document.documentElement, {
      attributeFilter: ['data-reduce-motion'],
      attributes: true,
    })
    return () => {
      media.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])

  return reduced
}

function getEffectiveReducedMotion(): boolean {
  if (typeof document !== 'undefined') {
    const value = document.documentElement.dataset.reduceMotion
    if (value === 'on') return true
    if (value === 'off') return false
  }
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
