import React from 'react'
import * as Tabs from '@radix-ui/react-tabs'

type Option<T extends string> = {
  value: T
  label: string
}

type Props<T extends string> = {
  value: T
  options: Option<T>[]
  onChange: React.Dispatch<React.SetStateAction<T>>
}

export function SegmentedControl<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <Tabs.Root
      className="segmented-control"
      value={value}
      onValueChange={nextValue => onChange(nextValue as T)}
    >
      <Tabs.List className="segmented-control-list">
      {options.map(option => (
        <Tabs.Trigger
          key={option.value}
          type="button"
          className={`segmented-control-item ${value === option.value ? 'active' : ''}`}
          value={option.value}
        >
          {option.label}
        </Tabs.Trigger>
      ))}
      </Tabs.List>
    </Tabs.Root>
  )
}
