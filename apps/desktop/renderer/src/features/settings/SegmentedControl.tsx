import { Button } from '../../components/ui/Button.js'
import { cx } from '../../utils/cx.js'

type Option<T extends string> = {
  value: T
  label: string
  disabled?: boolean
}

type Props<T extends string> = {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: Props<T>) {
  return (
    <div
      aria-label={ariaLabel}
      className={cx(
        'segmented-control',
        'tw:inline-flex',
        'tw:min-w-0',
        'tw:max-w-full',
        'tw:items-center',
        'tw:gap-0.5',
        'tw:overflow-x-auto',
        'tw:overflow-y-hidden',
        className,
      )}
      role="group"
    >
      {options.map(option => (
        <Button
          aria-pressed={option.value === value}
          className="segmented-control-item tw:shrink-0"
          disabled={option.disabled}
          key={option.value}
          size="compact"
          variant={option.value === value ? 'secondary' : 'ghost'}
          onClick={() => {
            if (!option.disabled) onChange(option.value)
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
