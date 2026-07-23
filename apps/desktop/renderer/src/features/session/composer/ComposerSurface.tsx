import type React from 'react'
import { forwardRef } from 'react'

type ComposerFrameProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

/**
 * Transparent placement frame for a composer or approval surface.
 * The child owns every visual surface property; this wrapper only owns width,
 * pointer-event restoration and the transition ref used by the shell.
 */
export const ComposerFrame = forwardRef<HTMLDivElement, ComposerFrameProps>(
  function ComposerFrame({ children, className, style }, ref) {
    const classNames = [
      'composer-frame',
      'tw:flex',
      'tw:w-full',
      'tw:max-w-[48rem]',
      'tw:flex-col',
      'tw:gap-2.5',
      'tw:pointer-events-auto',
      'tw:bg-transparent',
      'tw:p-0',
      'tw:shadow-none',
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

// Temporary source-compatible alias for extension code that imports the old
// name. It remains a transparent frame and no longer renders a card surface.
export const ComposerSurface = ComposerFrame
