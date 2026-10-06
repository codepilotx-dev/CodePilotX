import { APP_ICON_SIZES } from './iconTokens.js'
import React from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../../utils/cx.js'
import { useFloatingFocusModality } from '../../utils/floatingFocus.js'
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

/*
 * Trigger geometry migrated from `styles/components/input.scss` (`.ui-select-trigger`).
 * `width` and `max-width` stay with `.settings-dropdown.settings-dropdown-trigger`
 * plus the feature overrides that widen this trigger (`automation.scss`,
 * `_settings-appearance.scss`); a `tw:` utility outranks those layers.
 * Background, border-color, hover/open states and the focus-ring color remain on
 * the `[data-theme-component='dropdown-trigger']` contract in `styles/popover.scss`.
 */
const SELECT_TRIGGER_CLASSNAME =
  'ui-select-trigger settings-dropdown settings-dropdown-trigger tw:min-h-7 tw:min-w-0 tw:appearance-none tw:inline-flex tw:items-center tw:justify-between tw:gap-control-gap tw:border tw:rounded-control tw:px-row-inline tw:py-0 tw:text-left tw:type-control tw:cursor-pointer tw:outline-none tw:transition-[background-color,border-color,color,opacity] tw:duration-feedback tw:ease-out tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1'

/* Content and scroll frame migrated from the `.ui-select-*` rules in
 * `styles/components/input.scss`. Surface padding, border and shadow stay with
 * `.settings-dropdown-content` / `.popover-surface` in `styles/popover.scss`.
 * The scroll-area max height keeps the shared 320px popover budget minus the
 * 12px frame inset. */
const SELECT_CONTENT_CLASSNAME =
  'popover-surface ui-select-content settings-dropdown-content tw:min-w-max tw:[--popover-max-height:min(320px,calc(100vh-96px))] tw:[--popover-overflow-y:hidden]'

const SELECT_SCROLL_AREA_CLASSNAME =
  'ui-select-scroll-area settings-dropdown-scroll-area tw:grid tw:max-h-[max(80px,calc(min(320px,calc(100vh_-_96px))_-_12px))] tw:overflow-x-hidden tw:overflow-y-auto'

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
    <div className="ui-select-item-inner settings-dropdown-item-inner tw:flex tw:w-full tw:min-w-0 tw:items-center tw:gap-2">
      {option.icon}
      <div className="ui-select-item-copy settings-dropdown-item-copy tw:grid tw:min-w-0 tw:grow tw:shrink tw:basis-auto tw:gap-1">
        <span className="ui-select-item-label settings-dropdown-item-label tw:truncate tw:type-row-title">
          {option.label}
        </span>
        {option.detail ? (
          <span className="ui-select-item-detail settings-dropdown-item-detail tw:truncate tw:text-app-text-meta tw:type-caption">
            {option.detail}
          </span>
        ) : null}
      </div>
      {showSelectedIndicator && selected ? (
        <Check
          aria-hidden="true"
          className="ui-select-item-indicator settings-dropdown-item-indicator tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:text-app-accent-fg"
          size={APP_ICON_SIZES.sm}
        />
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
  const focusModality = useFloatingFocusModality()

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
        className={cx(SELECT_TRIGGER_CLASSNAME, triggerClassName)}
        data-theme-component="dropdown-trigger"
        data-variant={variant}
        {...focusModality.triggerInteractionProps}
      >
        <span className="ui-select-value settings-dropdown-value">
          {selectedOption?.icon}
          <RadixSelect.Value placeholder={placeholder ?? selectedOption?.label}>
            {selectedOption?.label}
          </RadixSelect.Value>
        </span>
        <RadixSelect.Icon asChild>
          <ChevronDown
            size={APP_ICON_SIZES.sm}
            aria-hidden="true"
            className="ui-select-icon settings-dropdown-icon tw:size-icon-sm tw:shrink-0 tw:text-app-text-meta"
          />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          align="start"
          className={SELECT_CONTENT_CLASSNAME}
          collisionPadding={6}
          data-theme-component="dropdown-surface"
          data-variant={variant}
          onCloseAutoFocus={focusModality.suppressFocusRingOnClose}
          position="popper"
          sideOffset={4}
          style={buildPopoverSizingStyle({
            width: width ?? 'var(--radix-select-trigger-width)',
            maxWidth: maxWidth ?? 'min(360px, calc(100vw - 16px))',
          })}
        >
          <RadixSelect.Viewport className={SELECT_SCROLL_AREA_CLASSNAME}>
            <div className="ui-select-scroll-content settings-dropdown-scroll-content tw:grid tw:min-w-0">
              {options.length ? (
                options.map((option) => (
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
                ))
              ) : (
                <div className="ui-select-empty settings-dropdown-empty tw:p-2 tw:text-app-text-soft tw:type-caption">
                  未找到匹配项
                </div>
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
  const focusModality = useFloatingFocusModality()
  const visibleOptions =
    remoteSearch || !normalizedQuery
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
    focusModality.refocusTrigger(triggerRef.current)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (query) updateSearch('')
      else {
        changeOpen(false)
        focusModality.refocusTrigger(triggerRef.current)
      }
      return
    }

    const enabledIndices = visibleOptions
      .map((option, index) => (option.disabled ? -1 : index))
      .filter((index) => index >= 0)

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!enabledIndices.length) return
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const currentPosition = enabledIndices.indexOf(activeIndex)
      const nextPosition =
        currentPosition < 0
          ? direction > 0
            ? 0
            : enabledIndices.length - 1
          : (currentPosition + direction + enabledIndices.length) % enabledIndices.length
      setActiveIndex(enabledIndices[nextPosition] ?? -1)
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(
        event.key === 'Home' ? (enabledIndices[0] ?? -1) : (enabledIndices.at(-1) ?? -1),
      )
      return
    }

    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      const option = visibleOptions[activeIndex]
      if (option) selectOption(option)
    }
  }

  const activeDescendant =
    activeIndex >= 0 ? `ui-select-option-${instanceId}-${activeIndex}` : undefined

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild {...focusModality.triggerInteractionProps}>
        <button
          ref={triggerRef}
          aria-label={ariaLabel}
          className={cx(SELECT_TRIGGER_CLASSNAME, triggerClassName)}
          data-theme-component="dropdown-trigger"
          data-variant={variant}
          disabled={disabled}
          type="button"
        >
          <span className="ui-select-value settings-dropdown-value">
            {selectedOption?.icon}
            <span>{selectedOption?.label ?? placeholder}</span>
          </span>
          <ChevronDown
            size={APP_ICON_SIZES.sm}
            aria-hidden="true"
            className="ui-select-icon settings-dropdown-icon tw:size-icon-sm tw:shrink-0 tw:text-app-text-meta"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          aria-label={ariaLabel}
          className="popover-surface ui-select-content ui-select-content--searchable settings-dropdown-content settings-dropdown-content--searchable tw:flex tw:min-h-0 tw:min-w-max tw:flex-col tw:[--popover-max-height:min(320px,calc(100vh-96px))] tw:[--popover-overflow-y:hidden]"
          collisionPadding={6}
          data-theme-component="dropdown-surface"
          data-variant={variant}
          onCloseAutoFocus={(event) => {
            updateSearch('')
            focusModality.suppressFocusRingOnClose(event)
          }}
          sideOffset={4}
          style={buildPopoverSizingStyle({
            width: width ?? 'auto',
            maxWidth: maxWidth ?? 'min(360px, calc(100vw - 16px))',
          })}
        >
          <div className="popover-search-region ui-select-search settings-dropdown-search tw:flex-none tw:bg-transparent tw:p-1">
            <SearchInput
              ref={searchRef}
              activeDescendant={activeDescendant}
              aria-label={searchPlaceholder}
              className="ui-select-search-input settings-dropdown-search-input tw:w-full tw:max-w-full tw:min-h-7"
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
          <div
            className="ui-select-scroll-area settings-dropdown-scroll-area tw:grid tw:min-h-0 tw:min-w-0 tw:max-h-none tw:grow tw:shrink tw:basis-auto tw:overflow-x-hidden tw:overflow-y-auto"
            id={listboxId}
            role="listbox"
          >
            <div className="ui-select-scroll-content settings-dropdown-scroll-content tw:grid tw:min-w-0">
              {loading ? (
                <div
                  className="ui-select-empty settings-dropdown-empty tw:p-2 tw:text-app-text-soft tw:type-caption"
                  role="status"
                >
                  正在加载…
                </div>
              ) : visibleOptions.length ? (
                visibleOptions.map((option, index) => (
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
                ))
              ) : (
                <div className="ui-select-empty settings-dropdown-empty tw:p-2 tw:text-app-text-soft tw:type-caption">
                  {emptyText}
                </div>
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
