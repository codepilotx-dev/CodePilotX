import type React from 'react'
import { ExternalLink } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { PluginCatalogItem } from './pluginCatalog.js'
import {
  PLUGIN_CATEGORY_LABELS,
  pluginPrimaryAction,
  pluginStatusLabel,
} from './pluginCatalog.js'

type ActionProps = {
  item: PluginCatalogItem
  busy?: boolean
  onPrimaryAction: (
    item: PluginCatalogItem,
    trigger: HTMLButtonElement,
    checked?: boolean,
  ) => void
}

export function PluginDetailsMetadata({
  item,
}: {
  item: PluginCatalogItem
}): React.ReactNode {
  return (
    <dl className="plugin-details-metadata">
      <div className="plugin-details-metadata__row">
        <dt>来源</dt>
        <dd>{PLUGIN_CATEGORY_LABELS[item.category]}</dd>
      </div>
      <div className="plugin-details-metadata__row">
        <dt>状态</dt>
        <dd>{pluginStatusLabel(item)}</dd>
      </div>
    </dl>
  )
}

export function PluginDetailsPrimaryAction({
  item,
  busy = false,
  onPrimaryAction,
}: ActionProps): React.ReactNode {
  const action = pluginPrimaryAction(item)
  const toggleRef = useRef<HTMLButtonElement>(null)

  if (action?.kind === 'toggle-builtin') {
    return (
      <span className="plugin-details-primary-toggle">
        <span>{action.checked ? '已启用' : '已禁用'}</span>
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
      </span>
    )
  }

  if (!action) return null

  return (
    <Button
      color="secondary"
      disabled={action.disabled}
      loading={busy}
      onClick={event => onPrimaryAction(item, event.currentTarget)}
    >
      {action.label}
      <ExternalLink
        aria-hidden="true"
        size={APP_ICON_SIZE}
        strokeWidth={APP_ICON_STROKE_WIDTH}
      />
    </Button>
  )
}
