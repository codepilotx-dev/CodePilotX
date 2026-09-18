import type React from 'react'
import { cx } from '../../utils/cx.js'

export type SkeletonRegionProps = {
  label: string
  className?: string
  children: React.ReactNode
}

export type SkeletonBlockProps = {
  className?: string
  label?: string
}

export function SkeletonRegion({
  label,
  className,
  children,
}: SkeletonRegionProps): React.ReactNode {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cx('ui-skeleton-region', className)}
      role="status"
    >
      <span className="u-sr-only">{label}</span>
      {children}
    </div>
  )
}

export function SkeletonBlock({
  className,
  label,
}: SkeletonBlockProps): React.ReactNode {
  return (
    <span
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      className={cx('ui-skeleton-block', className)}
      role={label ? 'status' : undefined}
    />
  )
}
