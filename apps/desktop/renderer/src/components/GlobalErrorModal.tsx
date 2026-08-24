import type React from 'react'
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'

import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.js'
import {
  enterTween,
  exitTween,
  motionTransition,
} from '../features/motion/motionTransitions.js'
import { IconButton } from './ui/IconButton.js'

type Props = {
  message: string | null
  onDismiss: () => void
  tone?: 'error' | 'status'
}

export function GlobalErrorModal({
  message,
  onDismiss,
  tone = 'error',
}: Props): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!message) return
    const timeout = window.setTimeout(() => {
      onDismissRef.current()
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [message])

  const isError = tone === 'error'

  return (
    <AnimatePresence initial={false} mode="wait">
      {message ? (
        <GlobalErrorPresence
          key={`${tone}:${message}`}
          isError={isError}
          message={message}
          reducedMotion={reducedMotion}
          onDismiss={onDismiss}
        />
      ) : null}
    </AnimatePresence>
  )
}

function GlobalErrorPresence({
  isError,
  message,
  onDismiss,
  reducedMotion,
}: {
  isError: boolean
  message: string
  onDismiss: () => void
  reducedMotion: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()

  return (
    <motion.div
      animate={{ opacity: 1, x: '-50%', y: 0 }}
      aria-hidden={!isPresent ? true : undefined}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`global-error-toast ${isError ? '' : 'status'} tw:flex tw:max-w-[min(55rem,calc(100vw-2rem))] tw:items-start tw:gap-2 tw:rounded-xl tw:border tw:border-app-border tw:bg-app-raised tw:px-3 tw:py-2 tw:text-base tw:text-app-text`}
      data-presence={isPresent ? 'present' : 'exiting'}
      exit={{
        opacity: 0,
        x: '-50%',
        y: -4,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, x: '-50%', y: -4 }}
      role={isError ? 'alert' : 'status'}
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      <div className="global-error-toast-scroll-area tw:min-w-0 tw:overflow-hidden tw:overflow-y-auto">
        <div className="global-error-toast-scroll-content">{message}</div>
      </div>
      <IconButton
        color="ghostSecondary"
        onClick={onDismiss}
        size="toolbar"
        title={isError ? '关闭错误提示' : '关闭通知'}
        type="button"
      >
        ×
      </IconButton>
    </motion.div>
  )
}
