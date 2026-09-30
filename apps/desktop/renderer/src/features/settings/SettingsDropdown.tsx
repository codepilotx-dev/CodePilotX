import type React from 'react'
import { Select, type SelectOption } from '../../components/ui/Select.js'
import type { PopoverSizingProps } from '../../components/ui/popoverSizing.js'
import { useLocale } from '../i18n/LocaleProvider.js'

type Option = SelectOption<string> & {
  label: string
  detail?: string
}

type Props = {
  value: string
  options: readonly Option[]
  onChange: (value: string) => void
  ariaLabel?: string
  disabled?: boolean
  variant?: 'default' | 'theme'
  searchable?: boolean
  searchPlaceholder?: string
  showSelectedIndicator?: boolean
  triggerClassName?: string
  /** Fired with the next open state; keeps user-gesture-driven side effects. */
  onOpenChange?: (open: boolean) => void
} & PopoverSizingProps

/** Settings compatibility wrapper. New feature code uses the shared Select. */
export function SettingsDropdown({
  onChange,
  ariaLabel = '选择选项',
  ...props
}: Props): React.ReactNode {
  const { t } = useLocale()
  return <Select {...props} options={props.options.map(option => ({
    ...option,
    label: t(option.label),
    detail: option.detail ? t(option.detail) : undefined,
  }))} ariaLabel={t(ariaLabel)} onValueChange={onChange} />
}
