import type React from 'react'
import type { ComposerCommand } from './composerSlashCommands.js'

export type ComposerMenuItem = {
  key: string
  section?: string
  label: string
  description?: string
  meta?: string
  icon: React.ReactNode
  matchText: string
  isActive?: boolean
  disabled?: boolean
  disabledReason?: string
  onSelect: () => void
  command?: ComposerCommand
}

type Props = {
  id: string
  items: ComposerMenuItem[]
  keyword: string
  emptyLabel?: string
  activeKey: string | null
  onActiveKeyChange: (key: string) => void
  onItemSelect: (item: ComposerMenuItem) => void
}

export function composerMenuItemId(menuId: string, key: string): string {
  return `${menuId}-item-${key.replace(/[^a-zA-Z0-9_-]/gu, '-')}`
}

export function filterComposerMenuItems(
  items: ComposerMenuItem[],
  keyword: string,
): ComposerMenuItem[] {
  const normalized = keyword.toLocaleLowerCase().trim()
  return normalized
    ? items.filter(item => item.matchText.toLocaleLowerCase().includes(normalized))
    : items
}

export function ComposerCommandMenu({
  id,
  items,
  keyword,
  emptyLabel = '无匹配项',
  activeKey,
  onActiveKeyChange,
  onItemSelect,
}: Props): React.ReactNode {
  const filtered = filterComposerMenuItems(items, keyword)
  if (filtered.length === 0) {
    return (
      <div aria-label="Composer 菜单" className="chat-input__dropdown-empty" id={id} role="listbox">
        {emptyLabel}
      </div>
    )
  }

  const sections = new Map<string, ComposerMenuItem[]>()
  for (const item of filtered) {
    const section = item.section ?? ''
    const sectionItems = sections.get(section) ?? []
    sectionItems.push(item)
    sections.set(section, sectionItems)
  }

  return (
    <div aria-label="Composer 菜单" className="chat-input__dropdown-items" id={id} role="listbox">
      {[...sections].map(([section, sectionItems], sectionIndex) => {
        const labelId = section ? `${id}-section-${sectionIndex}` : undefined
        return (
          <div aria-labelledby={labelId} key={section || 'items'} role={section ? 'group' : undefined}>
            {sectionIndex > 0 ? <div aria-hidden="true" className="chat-input__dropdown-separator" /> : null}
            {section ? (
              <div className="chat-input__dropdown-section-title" id={labelId}>
                {section}
              </div>
            ) : null}
            {sectionItems.map(item => (
              <button
                aria-disabled={item.disabled ? true : undefined}
                aria-current={item.isActive ? 'true' : undefined}
                className={[
                  'chat-input__dropdown-item',
                  item.isActive ? 'is-active' : '',
                  item.key === activeKey ? 'is-keyboard-active' : '',
                  item.disabled ? 'is-disabled' : '',
                ].join(' ')}
                id={composerMenuItemId(id, item.key)}
                key={item.key}
                onClick={() => {
                  if (!item.disabled) onItemSelect(item)
                }}
                onMouseEnter={() => {
                  if (!item.disabled) onActiveKeyChange(item.key)
                }}
                role="option"
                tabIndex={-1}
                title={item.disabled ? item.disabledReason : undefined}
                type="button"
              >
                <span className="chat-input__dropdown-leading">{item.icon}</span>
                <span className="chat-input__dropdown-copy">
                  <span className="chat-input__dropdown-label">{item.label}</span>
                  {item.description ? (
                    <span className="chat-input__dropdown-hint">{item.description}</span>
                  ) : null}
                </span>
                {item.meta ? (
                  <span className="chat-input__dropdown-meta">{item.meta}</span>
                ) : null}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
