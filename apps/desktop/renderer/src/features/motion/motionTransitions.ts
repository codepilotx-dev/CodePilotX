import type { Transition } from 'motion/react'

const standardEase = [0.16, 1, 0.3, 1] as const

export const instantTween: Transition = {
  duration: 0,
}

export const stateTween: Transition = {
  duration: 0.1,
  ease: standardEase,
}

export const enterTween: Transition = {
  duration: 0.12,
  ease: standardEase,
}

export const exitTween: Transition = {
  duration: 0.09,
  ease: standardEase,
}

export const layoutTween: Transition = {
  duration: 0.12,
  ease: standardEase,
}

export const loadingTween: Transition = {
  duration: 0.9,
  ease: 'linear',
}

// Compatibility names for components that still use the previous motion scale.
export const fastTween = stateTween
export const standardTween = enterTween
export const emphasisTween = layoutTween

export type FloatingSurfaceSide = 'top' | 'right' | 'bottom' | 'left'

export function floatingSurfaceMotion(side: FloatingSurfaceSide): {
  initial: { opacity: number; x: number; y: number }
  animate: { opacity: number; x: number; y: number }
  exit: { opacity: number; x: number; y: number }
} {
  const offset = side === 'top'
    ? { x: 0, y: 4 }
    : side === 'bottom'
      ? { x: 0, y: -4 }
      : side === 'left'
        ? { x: 4, y: 0 }
        : { x: -4, y: 0 }

  return {
    initial: { opacity: 0, ...offset },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, ...offset },
  }
}

export function motionTransition(
  reducedMotion: boolean,
  transition: Transition = enterTween,
): Transition {
  return reducedMotion ? instantTween : transition
}
