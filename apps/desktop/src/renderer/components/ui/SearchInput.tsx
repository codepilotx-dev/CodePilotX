import type React from 'react'
import { Search } from 'lucide-react'
import { APP_ICON_SIZE } from './iconTokens.js'

type Props = {
  placeholder: string
  value: string
  onChange: (value: string) => void
}

export function SearchInput({
  placeholder,
  value,
  onChange,
}: Props): React.ReactNode {
  return (
    <label className="search-input">
      <Search size={APP_ICON_SIZE} />
      <input
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  )
}
