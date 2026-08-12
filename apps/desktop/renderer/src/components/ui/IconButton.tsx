import { forwardRef } from 'react'
import type React from 'react'
import {
  Button,
  type ButtonColor,
  type ButtonProps,
} from './Button.js'

export type IconButtonSize =
  | 'composer'
  | 'composerSm'
  | 'composerUtility'
  | 'icon'
  | 'iconLarge'
  | 'iconMd'
  | 'iconSm'
  | 'tabStripAction'
  | 'toolbar'

type Props = Omit<ButtonProps, 'children' | 'color' | 'size' | 'uniform'> & {
  children: React.ReactNode
  title: string
  active?: boolean
  color: ButtonColor
  size: IconButtonSize
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton(
    {
      children,
      title,
      active = false,
      className,
      color,
      size,
      ...buttonProps
    },
    ref,
  ): React.ReactNode {
    return (
      <Button
        {...buttonProps}
        ref={ref}
        aria-label={title}
        className={['icon-button', className].filter(Boolean).join(' ')}
        color={color}
        data-active={active || undefined}
        size={size}
        title={title}
        uniform
      >
        {children}
      </Button>
    )
  },
)
