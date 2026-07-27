import { forwardRef, useCallback, useRef } from 'react'
import type React from 'react'
import { Search, X } from 'lucide-react'
import { APP_ICON_SIZE } from './iconTokens.js'
import { IconButton } from './IconButton.js'
import { cx } from '../../utils/cx.js'

type SearchInputVariant = 'standard' | 'compact' | 'embedded'

type SearchInputFilterMode = { mode?: 'filter' }

type SearchInputComboboxMode = {
  mode: 'combobox'
  controls: string
  expanded: boolean
  activeDescendant?: string
}

type SearchInputMode = SearchInputFilterMode | SearchInputComboboxMode

type SearchInputProps = {
  'aria-label': string
  clearLabel?: string
  onChange: (value: string) => void
  onEscapeEmpty?: () => void
  placeholder: string
  value: string
  variant?: SearchInputVariant
  /** IME composition in progress — suppresses Escape/arrow/Enter handling */
  isComposing?: boolean
} & SearchInputMode &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'aria-label'>

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      className,
      clearLabel = '清除搜索',
      onChange,
      onEscapeEmpty,
      onKeyDown,
      placeholder,
      value,
      variant = 'standard',
      isComposing = false,
      // mode props
      mode,
      controls,
      expanded,
      activeDescendant,
      // remaining input html attrs
      ...inputProps
    },
    forwardedRef,
  ): React.ReactNode {
    const inputRef = useRef<HTMLInputElement | null>(null)

    const setRef = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      },
      [forwardedRef],
    )

    const handleClear = useCallback((): void => {
      onChange('')
      // Restore focus to input after clearing
      inputRef.current?.focus()
    }, [onChange])

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>): void => {
        // IME composing — don't process Escape/arrow/Enter
        if (!isComposing) {
          if (event.key === 'Escape') {
            if (value.length > 0) {
              event.preventDefault()
              event.stopPropagation()
              onChange('')
              return
            }
            // Empty value: let parent handle
            onEscapeEmpty?.()
          }
        }

        onKeyDown?.(event)
      },
      [isComposing, value, onChange, onEscapeEmpty, onKeyDown],
    )

    const comboboxProps =
      mode === 'combobox'
        ? {
            role: 'combobox' as const,
            'aria-autocomplete': 'list' as const,
            'aria-controls': controls,
            'aria-expanded': expanded,
            'aria-activedescendant': activeDescendant,
          }
        : {}

    return (
      <div
        className={cx(
          'search-input',
          `search-input--${variant}`,
          className,
        )}
      >
        <Search
          aria-hidden="true"
          className="search-input-icon"
          size={APP_ICON_SIZE}
        />
        <input
          {...inputProps}
          {...comboboxProps}
          ref={setRef}
          aria-label={inputProps['aria-label'] ?? placeholder}
          className="search-input-field"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          type="search"
          value={value}
        />
        {value ? (
          <IconButton
            aria-label={clearLabel}
            className="search-input-clear"
            onClick={handleClear}
            size="sm"
            title={clearLabel}
            variant="plain"
          >
            <X size={APP_ICON_SIZE} />
          </IconButton>
        ) : null}
      </div>
    )
  },
)
