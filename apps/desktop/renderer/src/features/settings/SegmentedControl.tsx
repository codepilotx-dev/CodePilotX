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
      className="segmented-control tw:inline-flex tw:min-w-0"
      value={value}
      onValueChange={nextValue => onChange(nextValue as T)}
    >
      <Tabs.List className="segmented-control-list tw:flex tw:min-w-0 tw:items-center tw:gap-0.5 tw:rounded-lg tw:border tw:border-app-border tw:bg-app-chrome tw:p-1">
      {options.map(option => (
        <Tabs.Trigger
          key={option.value}
          type="button"
          className="segmented-control-item tw:min-h-7 tw:min-w-0 tw:rounded-md tw:px-3 tw:py-1.5 tw:text-sm tw:text-app-text-soft tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-app-panel tw:hover:text-app-text tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent tw:data-[state=active]:bg-app-raised tw:data-[state=active]:text-app-text tw:data-[state=active]:shadow-sm"
          value={option.value}
        >
          {option.label}
        </Tabs.Trigger>
      ))}
      </Tabs.List>
    </Tabs.Root>
  )
}
