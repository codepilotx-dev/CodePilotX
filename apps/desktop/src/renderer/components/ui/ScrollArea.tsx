import React from 'react'
import '../../styles/components/scroll-area.scss'

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
  const rootClassName = ['scroll-area', className].filter(Boolean).join(' ')
  const contentClass = ['scroll-area__content', contentClassName]
    .filter(Boolean)
    .join(' ')

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
