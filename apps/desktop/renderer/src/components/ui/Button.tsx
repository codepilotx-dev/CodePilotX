import { forwardRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/cx.js'
import { useResolvedButtonSize } from './TabStripButtonContext.js'

export type ButtonColor =
  | 'accent'
  | 'accentSubtle'
  | 'danger'
  | 'dangerSolid'
  | 'ghost'
  | 'ghostSecondary'
  | 'outlineActive'
  | 'ghostActive'
  | 'ghostMuted'
  | 'ghostTertiary'
  | 'outline'
  | 'primary'
  | 'secondary'
  | 'segmentedInsetSelected'

export type ButtonContentLayout = 'default' | 'balanced'
export type ButtonRadius = 'default' | 'large'
export type ButtonSize =
  | 'compact'
  | 'composer'
  | 'composerSm'
  | 'composerUtility'
  | 'default'
  | 'icon'
  | 'iconLarge'
  | 'iconMd'
  | 'iconSm'
  | 'large'
  | 'medium'
  | 'tabStripAction'
  | 'toolbar'
  | 'toolbarLabel'

export type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  allowShrink?: boolean
  color?: ButtonColor
  contentLayout?: ButtonContentLayout
  loading?: boolean
  radius?: ButtonRadius
  size?: ButtonSize
  uniform?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    allowShrink = false,
    children,
    className,
    color = 'primary',
    contentLayout = 'default',
    disabled,
    loading = false,
    radius = 'default',
    size = 'default',
    type = 'button',
    uniform = false,
    ...buttonProps
  },
  ref,
): React.ReactNode {
  const resolvedSize = useResolvedButtonSize(size)

  return (
    <button
      {...buttonProps}
      ref={ref}
      aria-busy={loading || undefined}
      className={cx(
        'ui-button',
        className,
      )}
      data-allow-shrink={allowShrink || undefined}
      data-color={color}
      data-content-layout={contentLayout}
      data-loading={loading || undefined}
      data-radius={radius}
      data-size={resolvedSize}
      data-uniform={uniform || undefined}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className="ui-button-spinner" /> : null}
      {children}
    </button>
  )
})
