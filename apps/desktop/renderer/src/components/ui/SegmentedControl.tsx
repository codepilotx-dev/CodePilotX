import { useRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/cx.js'
import { Button } from './Button.js'

type Option<T extends string> = {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

type Props<T extends string> = {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
  overflowMode?: 'auto' | 'fit'
  semantics?: 'group' | 'tabs'
  getTabId?: (value: T) => string
  getPanelId?: (value: T) => string
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  overflowMode = 'auto',
  semantics = 'group',
  getTabId,
  getPanelId,
}: Props<T>): React.ReactNode {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const isTabs = semantics === 'tabs'

  function selectByIndex(index: number): void {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    itemRefs.current[index]?.focus()
  }

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    if (!isTabs) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % options.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + options.length) % options.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = options.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    selectByIndex(nextIndex)
  }

  return (
    <div
      aria-label={ariaLabel}
      className={cx(
        'segmented-control',
        'tw:inline-flex',
        overflowMode === 'auto' ? 'tw:min-w-0' : 'tw:w-max',
        overflowMode === 'auto' ? 'tw:max-w-full' : 'tw:max-w-none',
        'tw:items-center',
        'tw:gap-0.5',
        overflowMode === 'auto' ? 'tw:overflow-x-auto' : 'tw:overflow-visible',
        overflowMode === 'auto' ? 'tw:overflow-y-hidden' : false,
        className,
      )}
      role={isTabs ? 'tablist' : 'group'}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <Button
            aria-controls={isTabs ? getPanelId?.(option.value) : undefined}
            aria-pressed={isTabs ? undefined : selected}
            aria-selected={isTabs ? selected : undefined}
            className="segmented-control-item tw:shrink-0"
            disabled={option.disabled}
            id={isTabs ? getTabId?.(option.value) : undefined}
            key={option.value}
            onClick={() => {
              if (!option.disabled) onChange(option.value)
            }}
            onKeyDown={event => handleTabKeyDown(event, index)}
            ref={element => {
              itemRefs.current[index] = element
            }}
            role={isTabs ? 'tab' : undefined}
            size="compact"
            tabIndex={isTabs ? (selected ? 0 : -1) : undefined}
            variant={selected ? 'secondary' : 'ghost'}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
