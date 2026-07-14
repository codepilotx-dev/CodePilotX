import type React from 'react'
import { forwardRef } from 'react'

type ComposerSurfaceProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  dispalyBottom?: boolean
}

export const ComposerSurface = forwardRef<HTMLDivElement, ComposerSurfaceProps>(
  function ComposerSurface(
    { children, className, style, dispalyBottom = false },
    ref,
  ) {
    const classNames = [
      'composer-surface',
      dispalyBottom ? 'composer-surface--display-bottom' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div ref={ref} className={classNames} style={style}>
        {children}
      </div>
    )
  },
)
