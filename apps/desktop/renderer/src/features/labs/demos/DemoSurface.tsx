import type { ReactNode } from 'react'

export function DemoSurface({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`lab-surface ${className}`}>{children}</div>
}
