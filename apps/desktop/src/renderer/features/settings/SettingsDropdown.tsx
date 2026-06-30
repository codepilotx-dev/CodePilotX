import React from 'react'
import * as Select from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'
import { preventOutsideDismissWhenDebug } from '../../components/ui/debugDropdown.js'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../components/ui/popoverSizing.js'
import { readDesktopBrowserDebugMode } from '../../services/desktopClient.js'

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
  disableOutsideDismiss?: boolean
} & PopoverSizingProps

const EMPTY_VALUE = '__radix_empty_value__'

export function SettingsDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'default',
  disableOutsideDismiss = readDesktopBrowserDebugMode(),
  width,
  maxWidth,
}: Props) {
  const selectedOption = options.find(o => o.value === value) || options[0]
  const radixValue = value === '' ? EMPTY_VALUE : value
  const isThemeVariant = variant === 'theme'

  return (
    <Select.Root
      value={radixValue}
      onValueChange={nextValue =>
        onChange(nextValue === EMPTY_VALUE ? '' : nextValue)
      }
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={`settings-dropdown${
          isThemeVariant ? ' theme-dropdown-trigger' : ''
        }`}
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
          align="start"
          className={`popover-surface settings-dropdown-content${
            isThemeVariant ? ' theme-dropdown-content' : ''
          }`}
          collisionPadding={12}
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
        >
          <Select.Viewport className="settings-dropdown-scroll-area">
            <div className="settings-dropdown-scroll-content">
              {options.map(opt => (
                <Select.Item
                  className="settings-dropdown-item"
                  key={opt.value}
                  tabIndex={-1}
                  value={opt.value === '' ? EMPTY_VALUE : opt.value}
                >
                  <div className="settings-dropdown-item-inner">
                    {opt.icon}
                    <div className="settings-dropdown-item-copy">
                      <Select.ItemText>{opt.label}</Select.ItemText>
                      {opt.detail ? <span>{opt.detail}</span> : null}
                    </div>
                  </div>
                </Select.Item>
              ))}
            </div>
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
