import { forwardRef, useCallback, useRef } from 'react'
import type React from 'react'
import { Search, X } from 'lucide-react'
import { APP_ICON_SIZE } from './iconTokens.js'
import { IconButton } from './IconButton.js'
import { cx } from '../../utils/cx.js'

export type SearchInputVariant = 'standard' | 'compact' | 'embedded'

type SearchInputFilterMode = { mode?: 'filter' }

type SearchInputComboboxMode = {
  mode: 'combobox'
  controls: string
  expanded: boolean
  activeDescendant?: string
}

type SearchInputMode = SearchInputFilterMode | SearchInputComboboxMode

export type SearchInputProps = {
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

/** Internal helper: strip discrimated-union fields not intended for <input> DOM. */
function stripModeFields(props: Record<string, unknown>): Record<string, unknown> {
  const { mode: _, controls: _c, expanded: _e, activeDescendant: _a, ...rest } = props
  return rest
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      'aria-label': ariaLabel,
      clearLabel = '清除搜索',
      onChange,
      onEscapeEmpty,
      onKeyDown,
      placeholder,
      value,
      variant = 'standard',
      isComposing = false,
      className,
      ...rawRest
    },
    forwardedRef,
  ): React.ReactNode {
    const inputRef = useRef<HTMLInputElement | null>(null)
    const isCombobox = rawRest.mode === 'combobox'
    const isFilter = rawRest.mode === undefined || rawRest.mode === 'filter'
    const safeInputProps = stripModeFields(rawRest)

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
      inputRef.current?.focus()
    }, [onChange])

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>): void => {
        if (!isComposing) {
          if (event.key === 'Escape') {
            if (value.length > 0) {
              event.preventDefault()
              event.stopPropagation()
              onChange('')
              return
            }
            onEscapeEmpty?.()
          }
        }
        onKeyDown?.(event)
      },
      [isComposing, value, onChange, onEscapeEmpty, onKeyDown],
    )

    const comboboxProps = isCombobox
      ? {
          role: 'combobox' as const,
          'aria-autocomplete': 'list' as const,
          'aria-controls': rawRest.controls ?? '',
          'aria-expanded': rawRest.expanded ?? false,
          'aria-activedescendant': rawRest.activeDescendant,
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
          {...safeInputProps}
          {...comboboxProps}
          ref={setRef}
          aria-label={ariaLabel}
          className="search-input-field"
          data-mode={
            isCombobox ? 'combobox' : isFilter ? 'filter' : undefined
          }
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
