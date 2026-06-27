import type React from 'react'
import { useEffect, useRef } from 'react'

type Props = {
  message: string | null
  onDismiss: () => void
}

export function GlobalErrorModal({ message, onDismiss }: Props): React.ReactNode {
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

  return (
    <div aria-live="assertive" className="global-error-toast" role="alert">
      <span>{message}</span>
      <button aria-label="关闭错误提示" onClick={onDismiss} type="button">
        ×
      </button>
    </div>
  )
}
