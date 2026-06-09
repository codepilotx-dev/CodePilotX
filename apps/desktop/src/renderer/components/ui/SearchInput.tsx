import type React from 'react'
import { Search } from 'lucide-react'

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
      <Search size={14} />
      <input
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  )
}
