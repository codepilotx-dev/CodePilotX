import { forwardRef } from 'react'
import * as Switch from '@radix-ui/react-switch'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}

export const ToggleSwitch = forwardRef<HTMLButtonElement, Props>(
  function ToggleSwitch(
    { checked, onChange, ariaLabel, disabled = false },
    ref,
  ) {
    return (
      <Switch.Root
        ref={ref}
        aria-label={ariaLabel}
        className="toggle-switch"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      >
        <Switch.Thumb className="toggle-knob" />
      </Switch.Root>
    )
  },
)
