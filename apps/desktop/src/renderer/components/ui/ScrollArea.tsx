import React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import './ScrollArea.css'

type ScrollAreaProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  direction?: 'y' | 'x'
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'dir' | 'color'>

export function ScrollArea({
  children,
  className,
  direction = 'y',
  style,
  ...rest
}: ScrollAreaProps): React.ReactNode {
  const rootClassName = ['scroll-area', className].filter(Boolean).join(' ')
  const orientation = direction === 'x' ? 'horizontal' : 'vertical'

  return (
    <ScrollAreaPrimitive.Root
      className={rootClassName}
      style={style}
      type="hover"
      {...rest}
    >
      <ScrollAreaPrimitive.Viewport className="scroll-area__viewport">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        className="scroll-area__scrollbar"
        orientation={orientation}
      >
        <ScrollAreaPrimitive.Thumb className="scroll-area__thumb" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner className="scroll-area__corner" />
    </ScrollAreaPrimitive.Root>
  )
}
