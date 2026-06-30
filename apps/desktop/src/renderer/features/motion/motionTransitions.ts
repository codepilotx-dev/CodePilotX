import type { Transition } from 'motion/react'

export const fastTween: Transition = {
  duration: 0.12,
  ease: [0.16, 1, 0.3, 1],
}

export const standardTween: Transition = {
  duration: 0.16,
  ease: [0.16, 1, 0.3, 1],
}

export const emphasisTween: Transition = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
}

export const instantTween: Transition = {
  duration: 0,
}

export function motionTransition(
  reducedMotion: boolean,
  transition: Transition = standardTween,
): Transition {
  return reducedMotion ? instantTween : transition
}
