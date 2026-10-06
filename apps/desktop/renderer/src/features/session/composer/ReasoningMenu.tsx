import { APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import React, { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check } from 'lucide-react'
import { cx } from '../../../utils/cx.js'
import type { ThinkingOption } from './ThinkingLevelPopover.js'

/*
 * Reasoning popover. `.composer-reasoning-menu-item` keeps its font in
 * `src/styles/primitives/composer.css`: the `.is-selected` state raises the
 * weight, and a bold override cannot sit next to a `font` shorthand role.
 */
const MENU_CLASS = cx(
  'composer-reasoning-menu-content tw:z-popover tw:w-35 tw:rounded-prominent tw:border tw:border-app-border-subtle',
  'tw:bg-app-raised tw:p-1.5 tw:shadow-lg tw:outline-none tw:select-none',
  'tw:animate-[composer-drop-in_var(--cpx-sys-motion-enter)_var(--cpx-sys-ease-standard)_both]',
)
const MENU_TITLE_CLASS =
  'composer-reasoning-menu-title tw:px-2.5 tw:py-1 tw:uppercase tw:tracking-[0.04em] tw:text-app-text-meta'
const MENU_LIST_CLASS = 'composer-reasoning-menu-list tw:flex tw:flex-col tw:gap-0.5'
const MENU_ITEM_CLASS = cx(
  'composer-reasoning-menu-item tw:flex tw:w-full tw:cursor-pointer tw:items-center tw:justify-between',
  'tw:rounded-control tw:border-0 tw:bg-transparent tw:px-2.5 tw:py-1.5 tw:text-app-text',
  'tw:transition-colors tw:duration-feedback tw:ease-standard tw:hover:bg-app-hover',
)
const MENU_ITEM_LABEL_CLASS = 'composer-reasoning-menu-item-label tw:truncate'
const MENU_CHECK_CLASS = 'composer-reasoning-menu-check tw:shrink-0 tw:text-app-accent-fg'

export type ReasoningMenuProps = {
  trigger: React.ReactElement
  thinkingMode: string
  thinkingPreviewMode?: string | null
  thinkingOptions: ThinkingOption[]
  onThinkingChange: (mode: string) => void
  onThinkingPreviewChange?: (mode: string | null) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ReasoningMenu({
  trigger,
  thinkingMode,
  thinkingPreviewMode,
  thinkingOptions,
  onThinkingChange,
  onThinkingPreviewChange,
  align = 'end',
  side = 'top',
  sideOffset = 6,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ReasoningMenuProps): React.ReactNode {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      onThinkingPreviewChange?.(null)
    }
    if (isControlled) {
      controlledOnOpenChange?.(nextOpen)
    } else {
      setInternalOpen(nextOpen)
    }
  }

  const effectiveCurrentMode = thinkingPreviewMode ?? thinkingMode

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={MENU_CLASS}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={MENU_TITLE_CLASS}>推理思考</div>
          <div className={MENU_LIST_CLASS} role="menu">
            {thinkingOptions.map((option) => {
              const isSelected = option.value === effectiveCurrentMode
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={(event) => {
                    event.stopPropagation()
                    onThinkingChange(option.value)
                    handleOpenChange(false)
                  }}
                  onPointerEnter={() => onThinkingPreviewChange?.(option.value)}
                  onPointerLeave={() => onThinkingPreviewChange?.(null)}
                  className={cx(MENU_ITEM_CLASS, isSelected && 'is-selected')}
                >
                  <span className={MENU_ITEM_LABEL_CLASS}>{option.label}</span>
                  {isSelected ? (
                    <Check
                      size={APP_ICON_SIZES.sm}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                      className={MENU_CHECK_CLASS}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
