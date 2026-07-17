import React from 'react'
import { cx } from '../../utils/cx.js'

type ScrollAreaProps = {
  children: React.ReactNode
  className?: string
  contentClassName?: string
  style?: React.CSSProperties
  direction?: 'y' | 'x'
  viewportRef?: React.Ref<HTMLDivElement>
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'dir' | 'color'>

export function ScrollArea({
  children,
  className,
  contentClassName,
  direction = 'y',
  style,
  viewportRef,
  ...rest
}: ScrollAreaProps): React.ReactNode {
  const rootClassName = cx(
    'scroll-area',
    'u-overflow-hidden',
    direction === 'x' ? 'u-overflow-x-auto' : 'u-overflow-y-auto',
    className,
  )
  const contentClass = cx(
    'scroll-area__content',
    'u-w-full',
    'u-min-w-0',
    contentClassName,
  )

  return (
    <div
      className={rootClassName}
      data-scroll-direction={direction}
      ref={viewportRef}
      style={style}
      {...rest}
    >
      <div className={contentClass}>{children}</div>
    </div>
  )
}
