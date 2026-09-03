import { useDesktopTheme } from '../features/theme/themeContext.js'

export function usePrefersReducedMotion(): boolean {
  try {
    return useDesktopTheme().reducedMotion
  } catch {
    return getEffectiveReducedMotion()
  }
}

export function getEffectiveReducedMotion(): boolean {
  if (typeof document !== 'undefined') {
    const value = document.documentElement.dataset.reduceMotion
    if (value === 'on') return true
    if (value === 'off') return false
  }
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
