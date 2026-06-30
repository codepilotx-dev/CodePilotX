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
      className={`global-error-toast ${isError ? '' : 'status'}`}
      role={isError ? 'alert' : 'status'}
    >
      <div className="global-error-toast-scroll-area">
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
