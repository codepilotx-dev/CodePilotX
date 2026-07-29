export type PopoverAnchorSide = 'right' | 'left'

export type PopoverAnchorPosition = {
  left: number
  side: PopoverAnchorSide
  top: number
}

export function anchorPopoverToButton(
  anchor: HTMLElement | null,
  popoverWidth: number,
  preferredSide: PopoverAnchorSide = 'right',
): PopoverAnchorPosition | null {
  if (!anchor) return null
  const anchorRect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const margin = 6

  let side: PopoverAnchorSide = preferredSide
  let left = preferredSide === 'right'
    ? anchorRect.right + margin
    : anchorRect.left - popoverWidth - margin

  if (side === 'right' && left + popoverWidth > viewportWidth - margin) {
    side = 'left'
    left = anchorRect.left - popoverWidth - margin
  } else if (side === 'left' && left < margin) {
    side = 'right'
    left = anchorRect.right + margin
  }

  left = Math.max(margin, Math.min(left, viewportWidth - popoverWidth - margin))

  return {
    left,
    side,
    top: anchorRect.top,
  }
}
