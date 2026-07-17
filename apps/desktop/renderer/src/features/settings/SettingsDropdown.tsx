import React from 'react'
import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, Search } from 'lucide-react'
import { preventOutsideDismissWhenDebug } from '../../components/ui/debugDropdown.js'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../components/ui/popoverSizing.js'
import { readDesktopBrowserDebugMode } from '../../services/desktopClient.js'
import { Input } from '../../components/ui/Input.js'

type Option = {
  value: string
  label: string
  detail?: string
  icon?: React.ReactNode
}

type Props = {
  value: string
  options: Option[]
  onChange: (value: string) => void
  ariaLabel?: string
  variant?: 'default' | 'theme'
  searchable?: boolean
  searchPlaceholder?: string
  disableOutsideDismiss?: boolean
  showSelectedIndicator?: boolean
} & PopoverSizingProps

const EMPTY_VALUE = '__radix_empty_value__'

export function SettingsDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'default',
  searchable = false,
  searchPlaceholder = '搜索...',
  disableOutsideDismiss = readDesktopBrowserDebugMode(),
  showSelectedIndicator = false,
  width,
  maxWidth,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const selectedOption = options.find((o) => o.value === value) || options[0]
  const radixValue = value === '' ? EMPTY_VALUE : value
  const isThemeVariant = variant === 'theme'
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleOptions = searchable
    ? options.filter((option) => {
        if (!normalizedQuery) return true
        return (
          option.label.toLowerCase().includes(normalizedQuery) ||
          option.value.toLowerCase().includes(normalizedQuery) ||
          option.detail?.toLowerCase().includes(normalizedQuery)
        )
      })
    : options

  React.useEffect(() => {
    if (!open || !searchable) return
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [open, searchable])

  return (
    <Select.Root
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
          sideOffset={1}
          style={buildPopoverSizingStyle({
            width,
            maxWidth:
              maxWidth ??
              (isThemeVariant
                ? 'min(calc(420px + var(--popover-width-extra)), calc(100vw - 24px))'
                : undefined),
          })}
          onPointerDownOutside={(event) => {
            preventOutsideDismissWhenDebug(disableOutsideDismiss, event)
          }}
          onCloseAutoFocus={() => {
            setSearchQuery('')
          }}
        >
          {searchable ? (
            <div className="settings-dropdown-search">
              <Search
                aria-hidden="true"
                className="settings-dropdown-search-icon"
              />
              <Input
                ref={searchInputRef}
                className="settings-dropdown-search-input"
                size="compact"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </div>
          ) : null}
          <Select.Viewport className="settings-dropdown-scroll-area">
            <div className="settings-dropdown-scroll-content">
              {visibleOptions.length ? (
                visibleOptions.map((opt) => (
                  <Select.Item
                    className="settings-dropdown-item"
                    key={opt.value}
                    tabIndex={-1}
                    value={opt.value === '' ? EMPTY_VALUE : opt.value}
                  >
                    <div className="settings-dropdown-item-inner">
                      {opt.icon}
                      <div className="settings-dropdown-item-copy">
                        <Select.ItemText>
                          <span className="settings-dropdown-item-label">
                            {opt.label}
                          </span>
                        </Select.ItemText>
                        {opt.detail ? (
                          <span className="settings-dropdown-item-detail">
                            {opt.detail}
                          </span>
                        ) : null}
                      </div>
                      {showSelectedIndicator ? (
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
