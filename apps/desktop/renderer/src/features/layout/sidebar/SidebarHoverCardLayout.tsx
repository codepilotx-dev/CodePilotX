import type React from 'react'
import { cx } from '../../../utils/cx.js'

type ContainerProps = React.HTMLAttributes<HTMLDivElement>

export function SidebarHoverCardFrame({
  className,
  ...props
}: ContainerProps): React.ReactNode {
  return (
    <div
      {...props}
      className={cx('sidebar-hover-card-layout', className)}
    />
  )
}

export function SidebarHoverCardHeader({
  className,
  ...props
}: ContainerProps): React.ReactNode {
  return (
    <div
      {...props}
      className={cx('sidebar-hover-card-header', className)}
    />
  )
}

export function SidebarHoverCardRow({
  className,
  ...props
}: ContainerProps): React.ReactNode {
  return (
    <div
      {...props}
      className={cx('sidebar-hover-card-row', className)}
    />
  )
}

export function SidebarHoverCardDivider({
  className,
  ...props
}: ContainerProps): React.ReactNode {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cx('sidebar-hover-card-divider', className)}
      role="separator"
    />
  )
}
