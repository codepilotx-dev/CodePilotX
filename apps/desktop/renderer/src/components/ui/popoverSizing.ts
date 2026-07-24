import type React from 'react'

export type PopoverSize = number | string

export type PopoverSizingProps = {
  width: PopoverSize
  maxWidth?: PopoverSize
}

type PopoverSizingStyle = React.CSSProperties & {
  '--popover-width'?: string
  '--popover-max-width'?: string
}

export function formatPopoverSize(size: PopoverSize): string {
  return typeof size === 'number' ? `${size}px` : size
}

export function buildPopoverSizingStyle({
  width,
  maxWidth,
}: Partial<PopoverSizingProps> = {}): PopoverSizingStyle {
  if (width === undefined) {
    throw new Error('Popover width is required. Pass a number, CSS size, or "auto".')
  }

  const style: PopoverSizingStyle = {}
  style['--popover-width'] = formatPopoverSize(width)
  if (maxWidth !== undefined) {
    style['--popover-max-width'] = formatPopoverSize(maxWidth)
  }
  return style
}
