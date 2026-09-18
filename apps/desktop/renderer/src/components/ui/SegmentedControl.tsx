import { useRef } from 'react'
import type React from 'react'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { cx } from '../../utils/cx.js'

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
  variant?: 'default' | 'inset'
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
  variant = 'default',
  getTabId,
  getPanelId,
}: Props<T>): React.ReactNode {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const isTabs = semantics === 'tabs'

  const rootClassName = cx(
    'segmented-control',
    'tw:inline-flex',
    overflowMode === 'auto' ? 'tw:min-w-0' : 'tw:w-max',
    overflowMode === 'auto' ? 'tw:max-w-full' : 'tw:max-w-none',
    'tw:items-center',
    'tw:gap-0.5',
    overflowMode === 'auto' ? 'tw:overflow-x-auto' : 'tw:overflow-visible',
    overflowMode === 'auto' ? 'tw:overflow-y-hidden' : false,
    className,
  )

  if (!isTabs) {
    return (
      <ToggleGroup.Root
        aria-label={ariaLabel}
        className={rootClassName}
        data-variant={variant}
        onValueChange={nextValue => {
          // 当前组件始终要求有一个选中值；点击已选项时 Radix 会传空字符串，忽略即可。
          if (nextValue) onChange(nextValue as T)
        }}
        orientation="horizontal"
        type="single"
        value={value}
      >
        {options.map(option => (
          <ToggleGroup.Item
            className="segmented-control-item tw:shrink-0"
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    )
  }

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
    const nextIndex = segmentedTabIndexAfterKey(event.key, index, options.length)
    if (nextIndex === null) return
    event.preventDefault()
    selectByIndex(nextIndex)
  }

  return (
    <div
      aria-label={ariaLabel}
      className={rootClassName}
      data-variant={variant}
      role="tablist"
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            aria-controls={getPanelId?.(option.value)}
            aria-selected={selected}
            className="segmented-control-item tw:shrink-0"
            disabled={option.disabled}
            id={getTabId?.(option.value)}
            key={option.value}
            onClick={() => {
              if (!option.disabled) onChange(option.value)
            }}
            onKeyDown={event => handleTabKeyDown(event, index)}
            ref={element => {
              itemRefs.current[index] = element
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function segmentedTabIndexAfterKey(
  key: string,
  index: number,
  optionCount: number,
): number | null {
  if (optionCount <= 0) return null
  if (key === 'ArrowRight') return (index + 1) % optionCount
  if (key === 'ArrowLeft') return (index - 1 + optionCount) % optionCount
  if (key === 'Home') return 0
  if (key === 'End') return optionCount - 1
  return null
}
