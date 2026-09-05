import type React from 'react'
import { useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { PluginCatalogItem } from './pluginCatalog.js'
import { pluginPrimaryAction, pluginStatusLabel } from './pluginCatalog.js'
import { PluginIcon } from './PluginIcon.js'

type Props = {
  item: PluginCatalogItem
  busy?: boolean
  error?: string | null
  onOpenDetails: (item: PluginCatalogItem, trigger: HTMLButtonElement) => void
  onPrimaryAction: (
    item: PluginCatalogItem,
    trigger: HTMLButtonElement,
    checked?: boolean,
  ) => void
}

export function PluginCatalogCard({
  item,
  busy = false,
  error,
  onOpenDetails,
  onPrimaryAction,
}: Props): React.ReactNode {
  const action = pluginPrimaryAction(item)
  const errorId = error ? `plugin-card-${item.id}-error` : undefined
  const toggleRef = useRef<HTMLButtonElement>(null)

  return (
    <li>
      <article
        className="plugin-catalog-card"
        data-plugin-category={item.category}
        data-plugin-status={item.status}
        data-plugin-tone={item.tone}
      >
        <button
          aria-describedby={errorId}
          className="plugin-catalog-card__main"
          data-catalog-item-id={`plugin:${item.id}`}
          onClick={event => onOpenDetails(item, event.currentTarget)}
          type="button"
        >
          <span aria-hidden="true" className="plugin-catalog-card__icon">
            <PluginIcon
              logoDarkSource={item.logoDarkSource}
              logoSource={item.logoSource}
              name={item.iconName}
            />
          </span>
          <span className="plugin-catalog-card__copy">
            <strong>{item.name}</strong>
            <span className="plugin-catalog-card__description">{item.description}</span>
            {item.category === 'manageable' || item.actionKind === 'install' || item.id === 'minimax' ? (
              <span className="plugin-catalog-card__meta">{pluginStatusLabel(item)}</span>
            ) : null}
            {error ? (
              <span className="plugin-catalog-card__error" id={errorId} role="status">
                {error}
              </span>
            ) : null}
          </span>
        </button>

        <div className="plugin-catalog-card__actions">
          {action.kind === 'toggle-plugin' ? (
            <ToggleSwitch
              ref={toggleRef}
              ariaLabel={`启用 ${item.name}`}
              checked={action.checked}
              disabled={action.disabled || busy}
              onChange={checked => {
                const trigger = toggleRef.current
                if (trigger) onPrimaryAction(item, trigger, checked)
              }}
            />
          ) : (
            <Button
              aria-describedby={errorId}
              className="plugin-catalog-card__external-action"
              color="secondary"
              disabled={action.disabled}
              loading={busy}
              onClick={event => onPrimaryAction(item, event.currentTarget)}
              size="toolbar"
            >
              {action.label}
              {action.kind === 'open-external' ? (
                <ExternalLink
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : null}
            </Button>
          )}
        </div>
      </article>
    </li>
  )
}
