import React, { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check } from 'lucide-react'
import type { ThinkingOption } from './ThinkingLevelPopover.js'

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
          className="composer-reasoning-menu-content"
          onClick={event => event.stopPropagation()}
        >
          <div className="composer-reasoning-menu-title">推理思考</div>
          <div className="composer-reasoning-menu-list" role="menu">
            {thinkingOptions.map(option => {
              const isSelected = option.value === effectiveCurrentMode
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={event => {
                    event.stopPropagation()
                    onThinkingChange(option.value)
                    handleOpenChange(false)
                  }}
                  onPointerEnter={() => onThinkingPreviewChange?.(option.value)}
                  onPointerLeave={() => onThinkingPreviewChange?.(null)}
                  className={`composer-reasoning-menu-item${isSelected ? ' is-selected' : ''}`}
                >
                  <span className="composer-reasoning-menu-item-label">
                    {option.label}
                  </span>
                  {isSelected ? (
                    <Check
                      size={14}
                      strokeWidth={2.6}
                      className="composer-reasoning-menu-check"
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
