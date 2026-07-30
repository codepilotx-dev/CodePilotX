import type React from 'react'
import { useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { buildPopoverSizingStyle, type PopoverSizingProps } from './popoverSizing.js'
import { SearchInput } from './SearchInput.js'
import { cx } from '../../utils/cx.js'

export type SearchablePopoverOption = {
  disabled?: boolean
  value: string
}

type Props<Option extends SearchablePopoverOption> = {
  align?: 'start' | 'center' | 'end'
  className?: string
  contentLabel: string
  emptyLabel: string
  footer?: React.ReactNode
  listClassName?: string
  listLabel: string
  onOpenChange: (open: boolean) => void
  onSearchChange: (value: string) => void
  onSelect: (option: Option) => void | Promise<void>
  open: boolean
  options: Option[]
  renderOption: (option: Option, selected: boolean) => React.ReactNode
  search: string
  searchLabel: string
  searchPlaceholder: string
  selectedValue?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  trigger: React.ReactElement
} & PopoverSizingProps

export function SearchablePopoverContent<Option extends SearchablePopoverOption>({
  align = 'start',
  className = '',
  contentLabel,
  emptyLabel,
  footer,
  listClassName = '',
  listLabel,
  onOpenChange,
  onSearchChange,
  onSelect,
  open,
  options,
  renderOption,
  search,
  searchLabel,
  searchPlaceholder,
  selectedValue,
  side = 'bottom',
  sideOffset = 4,
  trigger,
  width,
  maxWidth,
}: Props<Option>): React.ReactNode {
  const [activeIndex, setActiveIndex] = useState(-1)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listboxId = useId()
  const instanceId = useId()
  const activeDescendant =
    activeIndex >= 0 && activeIndex < options.length
      ? `${instanceId}-option-${activeIndex}`
      : undefined

  function resetAndSetOpen(nextOpen: boolean): void {
    if (!nextOpen) setActiveIndex(-1)
    onOpenChange(nextOpen)
  }

  function moveActive(direction: 1 | -1): void {
    const enabledIndices = options
      .map((option, index) => (option.disabled ? -1 : index))
      .filter(index => index >= 0)
    if (enabledIndices.length === 0) return
    const currentPosition = enabledIndices.indexOf(activeIndex)
    const nextPosition =
      (currentPosition + direction + enabledIndices.length) % enabledIndices.length
    setActiveIndex(enabledIndices[nextPosition] ?? -1)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      if (search) {
        event.preventDefault()
        event.stopPropagation()
        onSearchChange('')
        setActiveIndex(-1)
      } else {
        event.preventDefault()
        resetAndSetOpen(false)
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const enabledIndices = options
        .map((option, index) => (option.disabled ? -1 : index))
        .filter(index => index >= 0)
      const next =
        event.key === 'Home'
          ? enabledIndices[0]
          : enabledIndices[enabledIndices.length - 1]
      if (next !== undefined) setActiveIndex(next)
      return
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      const option = options[activeIndex]
      if (option && !option.disabled) {
        event.preventDefault()
        void onSelect(option)
      }
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={resetAndSetOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={contentLabel}
          align={align}
          className={cx(
            'popover-surface',
            'popover',
            'popover-menu--grid',
            'searchable-popover-content',
            'tw:text-app-text',
            className,
          )}
          collisionPadding={6}
          onOpenAutoFocus={event => {
            event.preventDefault()
            searchRef.current?.focus()
            searchRef.current?.select()
          }}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ width, maxWidth })}
        >
          <div className="popover-search-region">
            <SearchInput
              ref={searchRef}
              activeDescendant={activeDescendant}
              aria-label={searchLabel}
              controls={listboxId}
              expanded={open}
              mode="combobox"
              onChange={value => {
                onSearchChange(value)
                setActiveIndex(-1)
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              value={search}
              variant="compact"
            />
          </div>
          <div
            aria-label={listLabel}
            className={cx(
              'popover-scroll-content',
              'searchable-popover-list-scroll',
              listClassName,
            )}
            id={listboxId}
            role="listbox"
          >
            {options.length === 0 ? (
              <div className="popover-empty">{emptyLabel}</div>
            ) : (
              options.map((option, index) => {
                const selected = option.value === selectedValue
                return (
                  <button
                    aria-selected={selected}
                    className={[
                      'popover-item',
                      'tw:w-full',
                      'tw:min-w-0',
                      'tw:cursor-pointer',
                      'tw:items-center',
                      'tw:text-left',
                      'tw:text-app-text',
                      'tw:outline-none',
                      selected ? 'selected' : '',
                    ].join(' ')}
                    data-highlighted={index === activeIndex || undefined}
                    disabled={option.disabled}
                    id={`${instanceId}-option-${index}`}
                    key={option.value}
                    onClick={() => void onSelect(option)}
                    onMouseEnter={() => setActiveIndex(index)}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    {renderOption(option, selected)}
                  </button>
                )
              })
            )}
          </div>
          {footer ? (
            <div className="popover-scroll-content popover-footer-region">
              <div aria-hidden="true" className="popover-divider" />
              {footer}
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

type ActionProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode
  withArrow?: boolean
}

export function SearchablePopoverAction({
  children,
  className = '',
  icon,
  withArrow,
  ...buttonProps
}: ActionProps): React.ReactNode {
  return (
    <button
      {...buttonProps}
      className={['popover-item', className].join(' ')}
      type="button"
    >
      <span className="popover-item-leading">
        {icon ? <span className="popover-item-icon">{icon}</span> : null}
      </span>
      <span className="popover-item-label">{children}</span>
      {withArrow ? <span aria-hidden="true" className="popover-item-arrow">›</span> : null}
    </button>
  )
}
