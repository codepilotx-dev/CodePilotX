import { forwardRef } from 'react'
import type React from 'react'
import { Search } from 'lucide-react'
import { APP_ICON_SIZE } from './iconTokens.js'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'value'> & {
  placeholder: string
  value: string
  onChange: (value: string) => void
}

export const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput(
  {
    className,
    onChange,
    onKeyDown,
    placeholder,
    value,
    ...inputProps
  },
  ref,
): React.ReactNode {
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape' && value.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      onChange('')
    }
    onKeyDown?.(event)
  }

  return (
    <div className={['search-input', className].filter(Boolean).join(' ')}>
      <Search aria-hidden="true" size={APP_ICON_SIZE} />
      <input
        {...inputProps}
        onChange={event => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={ref}
        type="search"
        value={value}
      />
    </div>
  )
})
