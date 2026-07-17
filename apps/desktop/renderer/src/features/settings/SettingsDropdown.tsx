import React from 'react'
import * as Select from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'
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
  width,
  maxWidth,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const selectedOption = options.find(o => o.value === value) || options[0]
  const radixValue = value === '' ? EMPTY_VALUE : value
  const isThemeVariant = variant === 'theme'
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleOptions = searchable
    ? options.filter(option => {
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
      onValueChange={nextValue =>
        onChange(nextValue === EMPTY_VALUE ? '' : nextValue)
      }
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className="settings-dropdown tw:flex tw:min-h-8 tw:min-w-36 tw:items-center tw:justify-between tw:gap-2 tw:rounded-md tw:border tw:border-app-border tw:bg-app-raised tw:px-3 tw:py-2 tw:text-left tw:text-sm tw:text-app-text tw:shadow-sm tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-app-panel tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent"
        data-variant={variant}
        tabIndex={-1}
      >
        <div className="settings-dropdown-value tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:truncate">
          {selectedOption?.icon}
          <Select.Value placeholder={selectedOption?.label} />
        </div>
        <Select.Icon asChild>
          <ChevronDown className="settings-dropdown-icon tw:size-4 tw:shrink-0 tw:text-app-text-soft" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          align="start"
          className="popover-surface settings-dropdown-content tw:z-[var(--z-popover)] tw:max-h-[min(420px,calc(100vh-24px))] tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:p-1 tw:text-app-text tw:shadow-lg"
          collisionPadding={12}
          data-variant={variant}
          position="popper"
          side="bottom"
          sideOffset={6}
          style={buildPopoverSizingStyle({
            width,
            maxWidth:
              maxWidth ??
              (isThemeVariant
                ? 'min(calc(420px + var(--popover-width-extra)), calc(100vw - 24px))'
                : undefined),
          })}
          onPointerDownOutside={event => {
            preventOutsideDismissWhenDebug(disableOutsideDismiss, event)
          }}
          onCloseAutoFocus={() => {
            setSearchQuery('')
          }}
        >
          {searchable ? (
            <div className="settings-dropdown-search tw:border-b tw:border-app-border tw:p-1.5">
              <Input
                ref={searchInputRef}
                className="settings-dropdown-search-input tw:w-full tw:rounded-md tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-sm tw:text-app-text tw:outline-none tw:focus:border-app-accent tw:focus:ring-1 tw:focus:ring-app-accent"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                onKeyDown={event => event.stopPropagation()}
              />
            </div>
          ) : null}
          <Select.Viewport className="settings-dropdown-scroll-area tw:max-h-[inherit] tw:overflow-y-auto">
            <div className="settings-dropdown-scroll-content tw:grid tw:gap-0.5">
              {visibleOptions.length ? (
                visibleOptions.map(opt => (
                  <Select.Item
                    className="settings-dropdown-item tw:cursor-default tw:rounded-md tw:px-2 tw:py-2 tw:text-sm tw:text-app-text tw:outline-none tw:transition-colors tw:duration-[var(--motion-fast)] tw:data-[highlighted]:bg-app-panel tw:data-[state=checked]:bg-app-panel"
                    key={opt.value}
                    tabIndex={-1}
                    value={opt.value === '' ? EMPTY_VALUE : opt.value}
                  >
                    <div className="settings-dropdown-item-inner tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                      {opt.icon}
                      <div className="settings-dropdown-item-copy tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-0.5">
                        <Select.ItemText>{opt.label}</Select.ItemText>
                        {opt.detail ? <span className="tw:text-xs tw:text-app-text-soft">{opt.detail}</span> : null}
                      </div>
                    </div>
                  </Select.Item>
                ))
              ) : (
                <div className="settings-dropdown-empty tw:px-3 tw:py-4 tw:text-center tw:text-sm tw:text-app-text-soft">未找到匹配项</div>
              )}
            </div>
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
