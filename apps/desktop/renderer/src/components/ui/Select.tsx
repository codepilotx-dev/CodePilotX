import React from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../../utils/cx.js'
import { SearchInput } from './SearchInput.js'
import { buildPopoverSizingStyle, type PopoverSize } from './popoverSizing.js'

export type SelectOption<T extends string = string> = {
  value: T
  label: React.ReactNode
  detail?: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
}

export type SelectProps<T extends string = string> = {
  value: T
  options: readonly SelectOption<T>[]
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  searchValue?: string
  loading?: boolean
  emptyText?: string
  width?: PopoverSize
  maxWidth?: PopoverSize
  showSelectedIndicator?: boolean
  triggerClassName?: string
  variant?: string
  onOpenChange?: (open: boolean) => void
  onSearchChange?: (query: string) => void
  onValueChange: (value: T) => void
}

const EMPTY_VALUE = '__codepilotx_select_empty_value__'

function optionSearchText(option: SelectOption): string {
  return [option.value, option.label, option.detail]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLocaleLowerCase()
}

function OptionContent({
  option,
  selected,
  showSelectedIndicator,
}: {
  option: SelectOption
  selected: boolean
  showSelectedIndicator: boolean
}): React.ReactNode {
  return (
    <div className="ui-select-item-inner settings-dropdown-item-inner">
      {option.icon}
      <div className="ui-select-item-copy settings-dropdown-item-copy">
        <span className="ui-select-item-label settings-dropdown-item-label">
          {option.label}
        </span>
        {option.detail ? (
          <span className="ui-select-item-detail settings-dropdown-item-detail">
            {option.detail}
          </span>
        ) : null}
      </div>
      {showSelectedIndicator && selected ? (
        <Check aria-hidden="true" className="ui-select-item-indicator settings-dropdown-item-indicator" size={14} />
      ) : null}
    </div>
  )
}

function BasicSelect<T extends string>({
  value,
  options,
  ariaLabel,
  placeholder,
  disabled,
  width,
  maxWidth,
  showSelectedIndicator = true,
  triggerClassName,
  variant,
  onOpenChange,
  onValueChange,
}: SelectProps<T>): React.ReactNode {
  const selectedOption = options.find((option) => option.value === value)
  const radixValue = value === '' ? EMPTY_VALUE : value

  return (
    <RadixSelect.Root
      disabled={disabled}
      value={radixValue}
      onOpenChange={onOpenChange}
      onValueChange={(nextValue) => {
        onValueChange((nextValue === EMPTY_VALUE ? '' : nextValue) as T)
      }}
    >
      <RadixSelect.Trigger
        aria-label={ariaLabel}
        className={cx(
          'ui-select-trigger',
          'interactive-row',
          'interactive-row--toolbar',
          'settings-dropdown',
          'settings-dropdown-trigger',
          triggerClassName,
        )}
        data-theme-component="dropdown-trigger"
        data-variant={variant}
      >
        <span className="ui-select-value settings-dropdown-value">
          {selectedOption?.icon}
          <RadixSelect.Value placeholder={placeholder ?? selectedOption?.label}>
            {selectedOption?.label}
          </RadixSelect.Value>
        </span>
        <RadixSelect.Icon asChild>
          <ChevronDown aria-hidden="true" className="ui-select-icon settings-dropdown-icon" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          align="start"
          className="popover-surface ui-select-content settings-dropdown-content"
          collisionPadding={6}
          data-theme-component="dropdown-surface"
          data-variant={variant}
          position="popper"
          sideOffset={4}
          style={buildPopoverSizingStyle({
            width: width ?? 'var(--radix-select-trigger-width)',
            maxWidth: maxWidth ?? 'min(360px, calc(100vw - 16px))',
          })}
        >
          <RadixSelect.Viewport className="ui-select-scroll-area settings-dropdown-scroll-area">
            <div className="ui-select-scroll-content settings-dropdown-scroll-content">
              {options.length ? options.map((option) => (
                <RadixSelect.Item
                  className="ui-select-item settings-dropdown-item"
                  disabled={option.disabled}
                  key={option.value}
                  value={option.value === '' ? EMPTY_VALUE : option.value}
                >
                  <RadixSelect.ItemText asChild>
                    <div>
                      <OptionContent
                        option={option}
                        selected={option.value === value}
                        showSelectedIndicator={showSelectedIndicator}
                      />
                    </div>
                  </RadixSelect.ItemText>
                </RadixSelect.Item>
              )) : (
                <div className="ui-select-empty settings-dropdown-empty">未找到匹配项</div>
              )}
            </div>
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

function SearchableSelect<T extends string>({
  value,
  options,
  ariaLabel,
  placeholder,
  disabled,
  searchPlaceholder = '搜索…',
  searchValue,
  loading = false,
  emptyText = '未找到匹配项',
  width,
  maxWidth,
  showSelectedIndicator = true,
  triggerClassName,
  variant,
  onOpenChange,
  onSearchChange,
  onValueChange,
}: SelectProps<T>): React.ReactNode {
  const [open, setOpen] = React.useState(false)
  const [localSearchValue, setLocalSearchValue] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const listboxId = React.useId()
  const instanceId = React.useId().replace(/:/g, '')
  const selectedOption = options.find((option) => option.value === value)
  const query = searchValue ?? localSearchValue
  const remoteSearch = searchValue !== undefined || onSearchChange !== undefined
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleOptions = remoteSearch || !normalizedQuery
    ? options
    : options.filter((option) => optionSearchText(option).includes(normalizedQuery))

  function updateSearch(nextValue: string): void {
    if (searchValue === undefined) setLocalSearchValue(nextValue)
    onSearchChange?.(nextValue)
    setActiveIndex(-1)
  }

  function changeOpen(nextOpen: boolean): void {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
    if (!nextOpen) updateSearch('')
  }

  React.useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })
  }, [open])

  React.useEffect(() => {
    if (activeIndex >= visibleOptions.length) setActiveIndex(-1)
  }, [activeIndex, visibleOptions.length])

  function selectOption(option: SelectOption<T>): void {
    if (option.disabled) return
    onValueChange(option.value)
    changeOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (query) updateSearch('')
      else {
        changeOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
      }
      return
    }

    const enabledIndices = visibleOptions
      .map((option, index) => option.disabled ? -1 : index)
      .filter((index) => index >= 0)

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!enabledIndices.length) return
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const currentPosition = enabledIndices.indexOf(activeIndex)
      const nextPosition = currentPosition < 0
        ? (direction > 0 ? 0 : enabledIndices.length - 1)
        : (currentPosition + direction + enabledIndices.length) % enabledIndices.length
      setActiveIndex(enabledIndices[nextPosition] ?? -1)
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(event.key === 'Home'
        ? (enabledIndices[0] ?? -1)
        : (enabledIndices.at(-1) ?? -1))
      return
    }

    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      const option = visibleOptions[activeIndex]
      if (option) selectOption(option)
    }
  }

  const activeDescendant = activeIndex >= 0
    ? `ui-select-option-${instanceId}-${activeIndex}`
    : undefined

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          aria-label={ariaLabel}
          className={cx(
            'ui-select-trigger',
            'interactive-row',
            'interactive-row--toolbar',
            'settings-dropdown',
            'settings-dropdown-trigger',
            triggerClassName,
          )}
          data-theme-component="dropdown-trigger"
          data-variant={variant}
          disabled={disabled}
          type="button"
        >
          <span className="ui-select-value settings-dropdown-value">
            {selectedOption?.icon}
            <span>{selectedOption?.label ?? placeholder}</span>
          </span>
          <ChevronDown aria-hidden="true" className="ui-select-icon settings-dropdown-icon" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          aria-label={ariaLabel}
          className="popover-surface ui-select-content ui-select-content--searchable settings-dropdown-content settings-dropdown-content--searchable"
          collisionPadding={6}
          data-theme-component="dropdown-surface"
          data-variant={variant}
          sideOffset={4}
          style={buildPopoverSizingStyle({
            width: width ?? 'auto',
            maxWidth: maxWidth ?? 'min(360px, calc(100vw - 16px))',
          })}
        >
          <div className="popover-search-region ui-select-search settings-dropdown-search">
            <SearchInput
              ref={searchRef}
              activeDescendant={activeDescendant}
              aria-label={searchPlaceholder}
              className="ui-select-search-input settings-dropdown-search-input"
              controls={listboxId}
              expanded={open}
              mode="combobox"
              placeholder={searchPlaceholder}
              value={query}
              variant="compact"
              onChange={updateSearch}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="ui-select-scroll-area settings-dropdown-scroll-area" id={listboxId} role="listbox">
            <div className="ui-select-scroll-content settings-dropdown-scroll-content">
              {loading ? (
                <div className="ui-select-empty settings-dropdown-empty" role="status">正在加载…</div>
              ) : visibleOptions.length ? visibleOptions.map((option, index) => (
                <button
                  aria-selected={option.value === value}
                  className="ui-select-item settings-dropdown-item"
                  data-disabled={option.disabled || undefined}
                  data-highlighted={activeIndex === index || undefined}
                  disabled={option.disabled}
                  id={`ui-select-option-${instanceId}-${index}`}
                  key={option.value}
                  role="option"
                  tabIndex={-1}
                  type="button"
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <OptionContent
                    option={option}
                    selected={option.value === value}
                    showSelectedIndicator={showSelectedIndicator}
                  />
                </button>
              )) : (
                <div className="ui-select-empty settings-dropdown-empty">{emptyText}</div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function Select<T extends string>(props: SelectProps<T>): React.ReactNode {
  return props.searchable ? <SearchableSelect {...props} /> : <BasicSelect {...props} />
}
