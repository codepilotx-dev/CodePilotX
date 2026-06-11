import React from 'react'
import * as Select from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'

type Option = {
  value: string
  label: string
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
          className="settings-dropdown-content"
          position="popper"
          sideOffset={6}
        >
          <Select.Viewport className="settings-dropdown-viewport">
            {options.map(opt => (
              <Select.Item
                className="settings-dropdown-item"
                key={opt.value}
                value={opt.value === '' ? EMPTY_VALUE : opt.value}
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
