import React from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../components/ui/popoverSizing.js'
import { SearchInput } from '../../components/ui/SearchInput.js'

type Option = {
  value: string
  label: string
  detail?: string
  icon?: React.ReactNode
  disabled?: boolean
}

type Props = {
  value: string
  options: Option[]
  onChange: (value: string) => void
  ariaLabel?: string
  disabled?: boolean
  variant?: 'default' | 'theme'
  searchable?: boolean
  searchPlaceholder?: string
  showSelectedIndicator?: boolean
} & PopoverSizingProps

const EMPTY_VALUE = '__radix_empty_value__'

// ---------------------------------------------------------------------------
// Option rendering (used by Searchable branch only)
// ---------------------------------------------------------------------------
function renderOptionContent(
  opt: Option,
  showSelected: boolean,
  selected: boolean,
): React.ReactNode {
  return (
    <div className="settings-dropdown-item-inner">
      {opt.icon}
      <div className="settings-dropdown-item-copy">
        <span className="settings-dropdown-item-label">{opt.label}</span>
        {opt.detail ? (
          <span className="settings-dropdown-item-detail">{opt.detail}</span>
        ) : null}
      </div>
      {showSelected && selected ? (
        <Check aria-hidden="true" size={14} className="settings-dropdown-item-indicator" />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Non-searchable branch — unchanged Radix Select
// ---------------------------------------------------------------------------
function SelectSettingsDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  variant,
  showSelectedIndicator,
  width,
  maxWidth,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const selectedOption = options.find((o) => o.value === value) || options[0]
  const radixValue = value === '' ? EMPTY_VALUE : value
  const isThemeVariant = variant === 'theme'

  return (
    <Select.Root
      disabled={disabled}
      open={open}
      value={radixValue}
      onOpenChange={setOpen}
      onValueChange={(nextValue) =>
        onChange(nextValue === EMPTY_VALUE ? '' : nextValue)
      }
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className="settings-dropdown"
        data-variant={variant}
        tabIndex={-1}
      >
        <div className="settings-dropdown-value">
          {selectedOption?.icon}
          <Select.Value placeholder={selectedOption?.label} />
        </div>
        <Select.Icon asChild>
          <ChevronDown className="settings-dropdown-icon" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          align="end"
          className="popover-surface settings-dropdown-content"
          collisionPadding={6}
          data-variant={variant}
          position="popper"
          side="bottom"
          sideOffset={4}
          style={buildPopoverSizingStyle({
            width,
            maxWidth:
              maxWidth ??
              (isThemeVariant
                ? 'min(360px, calc(100vw - 16px))'
                : undefined),
          })}
        >
          <Select.Viewport className="settings-dropdown-scroll-area">
            <div className="settings-dropdown-scroll-content">
              {options.length ? (
                options.map((opt) => (
                  <Select.Item
                    className="settings-dropdown-item"
                    disabled={opt.disabled}
                    key={opt.value}
                    tabIndex={-1}
                    value={opt.value === '' ? EMPTY_VALUE : opt.value}
                  >
                    <div className="settings-dropdown-item-inner">
                      {opt.icon}
                      <div className="settings-dropdown-item-copy">
                        <Select.ItemText>
                          <span className="settings-dropdown-item-label">{opt.label}</span>
                        </Select.ItemText>
                        {opt.detail ? (
                          <span className="settings-dropdown-item-detail">{opt.detail}</span>
                        ) : null}
                      </div>
                      {(showSelectedIndicator ?? false) && opt.value === value ? (
                        <Select.ItemIndicator className="settings-dropdown-item-indicator">
                          <Check aria-hidden="true" size={14} />
                        </Select.ItemIndicator>
                      ) : null}
                    </div>
                  </Select.Item>
                ))
              ) : (
                <div className="settings-dropdown-empty">未找到匹配项</div>
              )}
            </div>
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

// ---------------------------------------------------------------------------
// Searchable branch — Radix Popover + SearchInput
// ---------------------------------------------------------------------------
function SearchableSettingsDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  variant,
  searchPlaceholder = '搜索...',
  showSelectedIndicator = false,
  width,
  maxWidth,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const listboxId = React.useId()
  const instanceId = React.useId()
  const selectedOption = options.find((o) => o.value === value) || options[0]

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleOptions = options.filter((opt) => {
    if (!normalizedQuery) return true
    return (
      opt.label.toLowerCase().includes(normalizedQuery) ||
      opt.value.toLowerCase().includes(normalizedQuery) ||
      opt.detail?.toLowerCase().includes(normalizedQuery)
    )
  })

  const activeDescendant =
    activeIndex >= 0 && activeIndex < visibleOptions.length
      ? `sd-option-${instanceId}-${visibleOptions[activeIndex].value}`
      : undefined

  // Open → focus search
  React.useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })
  }, [open])

  function clearSearch(): void {
    setSearchQuery('')
    setActiveIndex(-1)
    searchRef.current?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      if (searchQuery) {
        event.preventDefault()
        clearSearch()
      } else {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const enabledIndices = visibleOptions
        .map((opt, idx) => (opt.disabled ? -1 : idx))
        .filter((idx) => idx >= 0)
      if (enabledIndices.length === 0) return
      let next = activeIndex < 0 ? -1 : enabledIndices.indexOf(activeIndex)
      next = (next + direction + enabledIndices.length) % enabledIndices.length
      setActiveIndex(enabledIndices[next])
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      const firstEnabled = visibleOptions.findIndex((opt) => !opt.disabled)
      if (firstEnabled >= 0) setActiveIndex(firstEnabled)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      const lastEnabled = visibleOptions
        .map((opt, idx) => (opt.disabled ? -1 : idx))
        .filter((idx) => idx >= 0)
        .pop()
      if (lastEnabled !== undefined) setActiveIndex(lastEnabled)
      return
    }

    if (event.key === 'Enter' && activeIndex >= 0 && activeIndex < visibleOptions.length) {
      event.preventDefault()
      const selected = visibleOptions[activeIndex]
      if (selected && !selected.disabled) {
        onChange(selected.value)
        setOpen(false)
      }
    }
  }

  function selectOption(opt: Option): void {
    if (opt.disabled) return
    onChange(opt.value)
    setOpen(false)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSearchQuery('')
          setActiveIndex(-1)
        }
        setOpen(next)
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          aria-label={ariaLabel}
          className="settings-dropdown"
          data-variant={variant}
          disabled={disabled}
          tabIndex={-1}
          type="button"
        >
          <div className="settings-dropdown-value">
            {selectedOption?.icon}
            <span>{selectedOption?.label}</span>
          </div>
          <ChevronDown className="settings-dropdown-icon" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          className="popover-surface settings-dropdown-content"
          collisionPadding={6}
          data-variant={variant}
          side="bottom"
          sideOffset={4}
          style={buildPopoverSizingStyle({
            width:
              width ??
              undefined,
            maxWidth:
              maxWidth ??
              (variant === 'theme'
                ? 'min(360px, calc(100vw - 16px))'
                : undefined),
          })}
        >
          <div className="settings-dropdown-search">
            <SearchInput
              ref={searchRef}
              aria-label={searchPlaceholder}
              mode="combobox"
              controls={listboxId}
              expanded={open}
              activeDescendant={activeDescendant}
              className="settings-dropdown-search-input"
              onChange={setSearchQuery}
              onEscapeEmpty={undefined}
              placeholder={searchPlaceholder}
              value={searchQuery}
              variant="embedded"
              onKeyDown={handleKeyDown}
            />
          </div>
          <div
            className="settings-dropdown-scroll-area"
            id={listboxId}
            role="listbox"
          >
            <div className="settings-dropdown-scroll-content">
              {visibleOptions.length ? (
                visibleOptions.map((opt) => {
                  const idx = options.indexOf(opt)
                  return (
                    <button
                      aria-selected={opt.value === value}
                      className="settings-dropdown-item"
                      data-disabled={opt.disabled || undefined}
                      data-highlighted={idx === activeIndex || undefined}
                      disabled={opt.disabled}
                      id={`sd-option-${instanceId}-${opt.value}`}
                      key={opt.value}
                      onClick={() => selectOption(opt)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      role="option"
                      tabIndex={-1}
                      type="button"
                    >
                      {renderOptionContent(opt, showSelectedIndicator, opt.value === value)}
                    </button>
                  )
                })
              ) : (
                <div className="settings-dropdown-empty">未找到匹配项</div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ---------------------------------------------------------------------------
// Public component — dispatches to Select or Searchable branch
// ---------------------------------------------------------------------------
export function SettingsDropdown(props: Props): React.ReactNode {
  return props.searchable
    ? <SearchableSettingsDropdown {...props} />
    : <SelectSettingsDropdown {...props} />
}
