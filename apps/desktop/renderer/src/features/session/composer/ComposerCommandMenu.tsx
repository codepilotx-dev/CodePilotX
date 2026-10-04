import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { VList, type VListHandle } from 'virtua'
import type { ComposerCommand } from './composerSlashCommands.js'
export { filterComposerMenuItems } from './composerSuggestionMenu.js'

export type ComposerMenuItem = {
  key: string
  section?: string
  label: string
  description?: string
  meta?: string
  icon: React.ReactNode
  matchText: string
  searchPath?: string
  isActive?: boolean
  disabled?: boolean
  disabledReason?: string
  status?: 'loading' | 'error' | 'empty'
  completion?: 'category' | 'directory' | 'submenu'
  category?: string
  categoryOnly?: boolean
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

type MenuRow = { key: string; section: string } | { key: string; item: ComposerMenuItem }

export function composerMenuItemId(menuId: string, key: string): string {
  return `${menuId}-item-${encodeURIComponent(key)}`
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
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<VListHandle>(null)
  const [mask, setMask] = useState('none')
  const rows: MenuRow[] = []
  let previousSection: string | undefined
  for (const item of items) {
    if (item.section && item.section !== previousSection)
      rows.push({ key: `header:${item.section}`, section: item.section })
    rows.push({ key: item.key, item })
    previousSection = item.section
  }
  const virtual = rows.length > 50
  function updateMask(): void {
    const root = rootRef.current
    const list = listRef.current
    const offset = virtual ? (list?.scrollOffset ?? 0) : (root?.scrollTop ?? 0)
    const size = virtual ? (list?.scrollSize ?? 0) : (root?.scrollHeight ?? 0)
    const viewport = virtual ? (list?.viewportSize ?? 0) : (root?.clientHeight ?? 0)
    const top = offset > 1
    const bottom = size - viewport - offset > 1
    setMask(top && bottom ? 'both' : top ? 'top' : bottom ? 'bottom' : 'none')
  }
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    updateMask()
    const observer = new ResizeObserver(updateMask)
    observer.observe(root)
    return () => observer.disconnect()
  }, [items, virtual])
  useLayoutEffect(() => {
    const index = rows.findIndex((row) => row.key === activeKey)
    if (index < 0) return
    if (virtual) listRef.current?.scrollToIndex(index, { align: 'nearest' })
    else
      document
        .getElementById(composerMenuItemId(id, activeKey!))
        ?.scrollIntoView({ block: 'nearest' })
  }, [activeKey, items, virtual, id])

  function renderRow(row: MenuRow): React.ReactNode {
    if ('section' in row)
      return (
        <div className="chat-input__dropdown-section-title" role="presentation">
          {row.section}
        </div>
      )
    const item = row.item
    if (item.status)
      return (
        <div className="chat-input__dropdown-status" role="status">
          {item.label}
          {item.description ? `：${item.description}` : ''}
        </div>
      )
    return (
      <button
        aria-disabled={item.disabled || undefined}
        aria-selected={item.key === activeKey}
        className={[
          'chat-input__dropdown-item',
          item.isActive ? 'is-active' : '',
          item.key === activeKey ? 'is-keyboard-active' : '',
          item.disabled ? 'is-disabled' : '',
        ].join(' ')}
        id={composerMenuItemId(id, item.key)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!item.disabled) onItemSelect(item)
        }}
        onMouseMove={() => {
          if (!item.disabled) onActiveKeyChange(item.key)
        }}
        role="option"
        tabIndex={-1}
        title={item.disabled ? item.disabledReason : item.description}
        type="button"
      >
        <span className="chat-input__dropdown-leading">{item.icon}</span>
        <span className="chat-input__dropdown-copy">
          <span className="chat-input__dropdown-label">{item.label}</span>
          {item.description ? (
            <span className="chat-input__dropdown-hint">{item.description}</span>
          ) : null}
        </span>
        {item.meta ? <span className="chat-input__dropdown-meta">{item.meta}</span> : null}
      </button>
    )
  }

  return (
    <div
      aria-label="Composer 菜单"
      className="chat-input__suggestion-menu"
      data-scroll-mask={mask}
      id={id}
      ref={rootRef}
      role="listbox"
      onScroll={virtual ? undefined : updateMask}
    >
      {!items.some((item) => !item.status) && !items.some((item) => item.status === 'loading') ? (
        <div className="chat-input__dropdown-empty" role="status">
          {keyword ? emptyLabel : '暂无可用项'}
        </div>
      ) : null}
      {virtual ? (
        <VList
          className="chat-input__suggestion-vlist"
          data={rows}
          ref={listRef}
          onScroll={updateMask}
        >
          {(row) => <div key={row.key}>{renderRow(row)}</div>}
        </VList>
      ) : (
        rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)
      )}
    </div>
  )
}
