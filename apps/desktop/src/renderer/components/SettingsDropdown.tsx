import React from 'react'
import * as Select from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'

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
}

const EMPTY_VALUE = '__radix_empty_value__'

export function SettingsDropdown({ value, options, onChange, ariaLabel }: Props) {
  const selectedOption = options.find(o => o.value === value) || options[0]
  const radixValue = value === '' ? EMPTY_VALUE : value

  return (
    <Select.Root
      value={radixValue}
      onValueChange={nextValue =>
        onChange(nextValue === EMPTY_VALUE ? '' : nextValue)
      }
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className="settings-dropdown"
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
          className="settings-dropdown-content"
          collisionPadding={12}
          position="popper"
          side="bottom"
          sideOffset={6}
        >
          <Select.Viewport className="settings-dropdown-viewport">
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
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
