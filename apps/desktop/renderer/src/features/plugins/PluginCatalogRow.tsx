import type React from 'react'
import { ExternalLink, MoreHorizontal } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
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
  onPrimaryAction: (item: PluginCatalogItem, trigger: HTMLButtonElement) => void
}

export function PluginCatalogRow({
  item,
  busy = false,
  error,
  onOpenDetails,
  onPrimaryAction,
}: Props): React.ReactNode {
  const action = pluginPrimaryAction(item)
  const errorId = error ? `plugin-row-${item.id}-error` : undefined

  return (
    <li
      className="plugin-catalog-row"
      data-plugin-category={item.category}
      data-plugin-status={item.status}
      data-plugin-tone={item.tone}
    >
      <span aria-hidden="true" className="plugin-catalog-row__icon">
        <PluginIcon name={item.iconName} />
      </span>

      <div className="plugin-catalog-row__content">
        <h3>{item.name}</h3>
        <p className="plugin-catalog-row__description">{item.description}</p>
        {error ? (
          <p className="plugin-catalog-row__error" id={errorId} role="status">
            {error}
          </p>
        ) : null}
      </div>

      {item.category === 'manageable' ? (
        <span className="plugin-catalog-row__status">
          {pluginStatusLabel(item)}
        </span>
      ) : null}

      <div className="plugin-catalog-row__actions">
        {action ? (
          <Button
            aria-describedby={errorId}
            aria-pressed={action.pressed}
            disabled={action.disabled}
            loading={busy}
            onClick={event => onPrimaryAction(item, event.currentTarget)}
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
        ) : null}
        <IconButton
          onClick={event => onOpenDetails(item, event.currentTarget)}
          size="sm"
          title={`查看 ${item.name} 详情`}
          variant="plain"
        >
          <MoreHorizontal
            aria-hidden="true"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </IconButton>
      </div>
    </li>
  )
}
