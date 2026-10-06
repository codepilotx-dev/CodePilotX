import { forwardRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/cx.js'
import { useResolvedButtonSize } from './TabStripButtonContext.js'
import { Spinner, type SpinnerProps } from './Spinner.js'
import type { AppIconSize } from './iconTokens.js'

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
  iconSize?: AppIconSize
  loading?: boolean
  radius?: ButtonRadius
  size?: ButtonSize
  uniform?: boolean
}

/*
 * Appearance lives in this file as complete, static Tailwind class lists. The
 * semantic class names (`ui-button`, `icon-button`, `ui-button-spinner`) stay as
 * query hooks for features, browser harnesses and visual tests, and no longer
 * carry the visual contract themselves.
 *
 * Every value below is the one the deleted `src/styles/components/button.scss`
 * declared through `--cpx-comp-button-*`; the 4px spacing scale matches those
 * pixels exactly (4=16px, 5=20px, 6=24px, 7=28px, 8=32px, 9=36px), so button
 * geometry stays fixed while the UI font scale only moves `type-control`.
 */

/* Height and min-height per tier (`--cpx-comp-button-size-*`). */
const SIZE_BOX_CLASS: Record<ButtonSize, string> = {
  compact: 'tw:h-6 tw:min-h-6',
  composer: 'tw:h-7 tw:min-h-7',
  composerSm: 'tw:h-7 tw:min-h-7',
  composerUtility: 'tw:h-7 tw:min-h-7',
  default: 'tw:h-6 tw:min-h-6',
  icon: 'tw:h-7 tw:min-h-7',
  iconLarge: 'tw:h-9 tw:min-h-9',
  iconMd: 'tw:h-5 tw:min-h-5',
  iconSm: 'tw:h-4 tw:min-h-4',
  large: 'tw:h-9 tw:min-h-9',
  medium: 'tw:h-8 tw:min-h-8',
  tabStripAction: 'tw:h-9 tw:min-h-9',
  toolbar: 'tw:h-7 tw:min-h-7',
  toolbarLabel: 'tw:h-7 tw:min-h-7',
}

/*
 * Radius is a separate map because `radius="large"` replaces the tier radius;
 * two rounded-* utilities on one element would be decided by Tailwind's source
 * order instead of by the prop.
 */
const SIZE_RADIUS_CLASS: Record<ButtonSize, string> = {
  compact: 'tw:rounded-lg',
  composer: 'tw:rounded-full',
  composerSm: 'tw:rounded-full',
  composerUtility: 'tw:rounded-full',
  default: 'tw:rounded-full',
  icon: 'tw:rounded-md',
  iconLarge: 'tw:rounded-2xl',
  iconMd: 'tw:rounded-md',
  iconSm: 'tw:rounded-md',
  large: 'tw:rounded-full',
  medium: 'tw:rounded-lg',
  tabStripAction: 'tw:rounded-lg',
  toolbar: 'tw:rounded-lg',
  toolbarLabel: 'tw:rounded-lg',
}

/* `--cpx-comp-button-radius-lg`, applied by `[data-radius='large']`. */
const RADIUS_LARGE_CLASS = 'tw:rounded-lg'

/*
 * Horizontal padding is also separate: `uniform` replaces it with `0`, and the
 * size tier only supplies the default.
 */
const SIZE_PADDING_CLASS: Record<ButtonSize, string> = {
  compact: 'tw:px-2',
  composer: 'tw:px-2',
  composerSm: 'tw:px-1.5',
  composerUtility: 'tw:px-1.5',
  default: 'tw:px-2',
  icon: 'tw:px-1',
  iconLarge: 'tw:px-0',
  iconMd: 'tw:px-0.5',
  iconSm: 'tw:px-0.5',
  large: 'tw:px-5',
  medium: 'tw:px-4',
  tabStripAction: 'tw:px-2',
  toolbar: 'tw:px-2',
  toolbarLabel: 'tw:px-2.5',
}

const UNIFORM_PADDING_CLASS = 'tw:px-0'

/* Direct-child icon size per tier (`--button-icon-size*`). */
const SIZE_ICON_CLASS: Record<ButtonSize, string> = {
  compact: 'tw:[&>svg]:size-icon-sm',
  composer: 'tw:[&>svg]:size-icon',
  composerSm: 'tw:[&>svg]:size-icon-sm',
  composerUtility: 'tw:[&>svg]:size-icon',
  default: 'tw:[&>svg]:size-icon-md',
  icon: 'tw:[&>svg]:size-icon',
  iconLarge: 'tw:[&>svg]:size-icon-lg',
  iconMd: 'tw:[&>svg]:size-icon-sm',
  iconSm: 'tw:[&>svg]:size-icon-sm',
  large: 'tw:[&>svg]:size-icon-lg',
  medium: 'tw:[&>svg]:size-icon',
  tabStripAction: 'tw:[&>svg]:size-icon',
  toolbar: 'tw:[&>svg]:size-icon',
  toolbarLabel: 'tw:[&>svg]:size-icon',
}

/*
 * `data-icon-size` (`iconSize`) overrides both the icon slot and the loading
 * indicator; the override must replace the tier class instead of competing with
 * it.
 */
const ICON_OVERRIDE_ICON_CLASS: Record<AppIconSize, string> = {
  sm: 'tw:[&>svg]:size-icon-sm',
  md: 'tw:[&>svg]:size-icon-md',
  lg: 'tw:[&>svg]:size-icon-lg',
}

const ICON_OVERRIDE_SPINNER_SIZE: Record<AppIconSize, SpinnerProps['size']> = {
  sm: 'small',
  md: 'medium',
  lg: 'large',
}

/*
 * The trailing chevron slot is not a class here: the selector names Lucide's own
 * chevron classes, which must not appear inside a rendered `class` attribute.
 * `src/styles/primitives/button.css` owns it and reads `data-icon-size` instead.
 */

/* The spinner mirrors the tier icon slot, so Button decides its final size. */
const SIZE_SPINNER_SIZE: Record<ButtonSize, SpinnerProps['size']> = {
  compact: 'small',
  composer: 'medium',
  composerSm: 'small',
  composerUtility: 'medium',
  default: 'medium',
  icon: 'medium',
  iconLarge: 'large',
  iconMd: 'small',
  iconSm: 'small',
  large: 'large',
  medium: 'medium',
  tabStripAction: 'medium',
  toolbar: 'medium',
  toolbarLabel: 'medium',
}

/*
 * Ghost surfaces: the plain ghost button takes the hover surface, while the
 * icon-only variant marked by the `icon-button` hook keeps a transparent surface
 * and only lifts its foreground. That second half — together with the resting
 * foreground of every ghost tier — lives in `src/styles/primitives/button.css`,
 * because a colour and the state rule that changes it have to share one layer.
 */
const GHOST_STATE_CLASS = cx(
  'tw:[&:not(.icon-button):enabled:hover]:bg-app-hover',
  'tw:[&:not(.icon-button)[data-state=open]]:bg-app-hover',
  'tw:[&:not(.icon-button)[data-active]]:bg-app-hover',
)

/* `ghostMuted` / `ghostTertiary` only lift their foreground, never the surface. */
const MUTED_GHOST_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-transparent',
  'tw:[&:enabled:hover]:text-app-text',
  'tw:data-[state=open]:bg-transparent',
  'tw:data-[state=open]:text-app-text',
  'tw:data-[active]:bg-transparent',
  'tw:data-[active]:text-app-text',
)

/*
 * The hover/open/active surface of a tier. Each state is its own utility: a
 * comma-separated selector list would have to be escaped inside the class name,
 * and a backslash written in a JS string literal disappears, so the rendered
 * class could never match Tailwind's escaped selector.
 */
const ACCENT_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent)_90%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent)_90%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent)_90%,transparent)]',
)

const ACCENT_SUBTLE_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent-fg)_15%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent-fg)_15%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent-fg)_15%,transparent)]',
)

const DANGER_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_20%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_20%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_20%,transparent)]',
)

const DANGER_SOLID_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_90%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_90%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_90%,transparent)]',
)

const OUTLINE_ACTIVE_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_15%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_15%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_15%,transparent)]',
)

const SECONDARY_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_10%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_10%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_10%,transparent)]',
)

const HOVER_SURFACE_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-app-hover',
  'tw:data-[state=open]:bg-app-hover',
  'tw:data-[active]:bg-app-hover',
)

const PRIMARY_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-app-primary-action-hover',
  'tw:data-[state=open]:bg-app-primary-action-hover',
  'tw:data-[active]:bg-app-primary-action-hover',
  // `--cpx-comp-button-primary-active-bg` repeats the hover mix verbatim.
  'tw:[&:active:not(:disabled)]:bg-app-primary-action-hover',
)

/*
 * Colour mixes stay readable as arbitrary utilities: Tailwind emits a plain
 * fallback declaration plus an `@supports (color: color-mix(...))` override,
 * which the Chromium runtime always takes.
 */
const COLOR_CLASS: Record<ButtonColor, string> = {
  accent: cx('tw:border-transparent tw:bg-app-accent tw:text-app-on-accent', ACCENT_STATE_CLASS),
  accentSubtle: cx(
    'tw:border-transparent tw:text-app-accent-fg',
    'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent-fg)_10%,transparent)]',
    ACCENT_SUBTLE_STATE_CLASS,
  ),
  danger: cx(
    'tw:border-transparent tw:text-app-chart-red',
    'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_10%,transparent)]',
    DANGER_STATE_CLASS,
  ),
  dangerSolid: cx(
    'tw:border-transparent tw:bg-app-chart-red tw:text-app-on-accent',
    DANGER_SOLID_STATE_CLASS,
  ),
  ghost: cx('tw:border-transparent tw:bg-transparent', GHOST_STATE_CLASS),
  ghostSecondary: cx('tw:border-transparent tw:bg-transparent', GHOST_STATE_CLASS),
  ghostActive: cx('tw:border-transparent tw:bg-transparent', GHOST_STATE_CLASS),
  ghostMuted: cx('tw:border-transparent tw:bg-transparent', MUTED_GHOST_STATE_CLASS),
  ghostTertiary: cx('tw:border-transparent tw:bg-transparent', MUTED_GHOST_STATE_CLASS),
  outline: cx('tw:border-app-border tw:bg-transparent tw:text-app-text', HOVER_SURFACE_STATE_CLASS),
  outlineActive: cx(
    'tw:border-app-border tw:text-app-text',
    'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_10%,transparent)]',
    OUTLINE_ACTIVE_STATE_CLASS,
  ),
  primary: cx(
    'tw:border-app-border-strong tw:bg-app-primary-action tw:text-app-primary-action-foreground',
    PRIMARY_STATE_CLASS,
  ),
  secondary: cx(
    'tw:border-transparent tw:text-app-text',
    'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_5%,transparent)]',
    SECONDARY_STATE_CLASS,
    'tw:[&:active:not(:disabled)]:bg-app-active',
  ),
}

const BASE_CLASS = cx(
  'tw:box-border tw:items-center tw:justify-center tw:gap-1 tw:border tw:shadow-none',
  'tw:type-control tw:whitespace-nowrap tw:select-none tw:cursor-pointer',
  'tw:transition-[background-color,border-color,color,opacity] tw:duration-feedback tw:ease-standard',
  'tw:[&>svg]:block tw:[&>svg]:flex-none',
  'tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus',
  'tw:disabled:cursor-not-allowed tw:disabled:opacity-40',
  'tw:aria-disabled:cursor-not-allowed tw:aria-disabled:opacity-40',
  'tw:aria-pressed:bg-app-selected tw:aria-pressed:text-app-text',
)

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    allowShrink = false,
    children,
    className,
    color = 'primary',
    contentLayout = 'default',
    disabled,
    iconSize,
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
  const spinnerSize = iconSize
    ? ICON_OVERRIDE_SPINNER_SIZE[iconSize]
    : SIZE_SPINNER_SIZE[resolvedSize]

  return (
    <button
      {...buttonProps}
      ref={ref}
      aria-busy={loading || undefined}
      className={cx(
        'ui-button',
        BASE_CLASS,
        contentLayout === 'balanced' ? 'tw:grid tw:grid-cols-[1fr_auto_1fr]' : 'tw:inline-flex',
        SIZE_BOX_CLASS[resolvedSize],
        radius === 'large' ? RADIUS_LARGE_CLASS : SIZE_RADIUS_CLASS[resolvedSize],
        uniform ? UNIFORM_PADDING_CLASS : SIZE_PADDING_CLASS[resolvedSize],
        uniform && 'tw:aspect-square tw:shrink-0',
        allowShrink && 'tw:min-w-0',
        COLOR_CLASS[color],
        iconSize ? ICON_OVERRIDE_ICON_CLASS[iconSize] : SIZE_ICON_CLASS[resolvedSize],
        className,
      )}
      data-allow-shrink={allowShrink || undefined}
      data-color={color}
      data-content-layout={contentLayout}
      data-icon-size={iconSize}
      data-loading={loading || undefined}
      data-radius={radius}
      data-size={resolvedSize}
      data-uniform={uniform || undefined}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <Spinner className="ui-button-spinner" size={spinnerSize} /> : null}
      {children}
    </button>
  )
})
