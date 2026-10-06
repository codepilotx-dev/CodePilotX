import { forwardRef } from 'react'
import type React from 'react'

export const Toast = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Toast({ className = '', ...props }, ref): React.ReactNode {
    return (
      <div
        {...props}
        ref={ref}
        className={`tw:inline-flex tw:min-h-10 tw:items-center tw:gap-1.5 tw:rounded-[var(--cpx-sys-radius-xl)] tw:border tw:border-app-border-subtle tw:bg-app-glass tw:px-2 tw:py-1.5 tw:type-body tw:text-app-text tw:shadow-lg tw:backdrop-blur-[18px] tw:[-webkit-app-region:no-drag] ${className}`}
      />
    )
  },
)

export function ToastDivider({ className = '' }: { className?: string } = {}): React.ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`tw:mx-0.5 tw:h-4 tw:w-px tw:shrink-0 tw:bg-app-border-subtle ${className}`}
    />
  )
}
