import type React from 'react'
import { useEffect, useRef } from 'react'

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

  if (!message) return null

  const isError = tone === 'error'

  return (
    <div
      aria-live={isError ? 'assertive' : 'polite'}
      className={`global-error-toast ${isError ? '' : 'status'} tw:flex tw:max-w-[min(55rem,calc(100vw-2rem))] tw:items-start tw:gap-2 tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:px-3 tw:py-2 tw:text-base tw:text-app-text tw:shadow-lg`}
      role={isError ? 'alert' : 'status'}
    >
      <div className="global-error-toast-scroll-area tw:min-w-0 tw:overflow-hidden tw:overflow-y-auto">
        <div className="global-error-toast-scroll-content">{message}</div>
      </div>
      <button
        aria-label={isError ? '关闭错误提示' : '关闭通知'}
        onClick={onDismiss}
        type="button"
      >
        ×
      </button>
    </div>
  )
}
