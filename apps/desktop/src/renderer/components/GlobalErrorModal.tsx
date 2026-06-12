import type React from 'react'

type Props = {
  message: string | null
  onDismiss: () => void
}

export function GlobalErrorModal({ message, onDismiss }: Props): React.ReactNode {
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
