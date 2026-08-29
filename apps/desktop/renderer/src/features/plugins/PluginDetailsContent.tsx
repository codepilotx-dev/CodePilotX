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
      {item.version ? (
        <div className="plugin-details-metadata__row">
          <dt>版本</dt>
          <dd>{item.version}</dd>
        </div>
      ) : null}
      {item.developerName ? (
        <div className="plugin-details-metadata__row">
          <dt>开发者</dt>
          <dd>{item.developerName}</dd>
        </div>
      ) : null}
      {item.capabilities?.length ? (
        <div className="plugin-details-metadata__row">
          <dt>能力</dt>
          <dd>{item.capabilities.join('、')}</dd>
        </div>
      ) : null}
      {item.skills?.length ? (
        <div className="plugin-details-metadata__row">
          <dt>技能</dt>
          <dd>{item.skills.join('、')}</dd>
        </div>
      ) : null}
      {item.unavailableReason ? (
        <div className="plugin-details-metadata__row">
          <dt>说明</dt>
          <dd>{item.unavailableReason}</dd>
        </div>
      ) : null}
      {item.miniMaxCli?.latestVersion ? (
        <div className="plugin-details-metadata__row">
          <dt>最新版本</dt>
          <dd>{item.miniMaxCli.latestVersion}</dd>
        </div>
      ) : null}
      {item.miniMaxCli ? (
        <div className="plugin-details-metadata__row">
          <dt>认证</dt>
          <dd>{miniMaxAuthLabel(item.miniMaxCli.authStatus)}</dd>
        </div>
      ) : null}
      {item.miniMaxCli?.credentialSource ? (
        <div className="plugin-details-metadata__row">
          <dt>当前 Key</dt>
          <dd>{item.miniMaxCli.credentialSource.label} · {item.miniMaxCli.credentialSource.maskedValue}</dd>
        </div>
      ) : null}
      {item.miniMaxCli?.credentialSource ? (
        <div className="plugin-details-metadata__row">
          <dt>区域</dt>
          <dd>{item.miniMaxCli.credentialSource.region === 'cn' ? '中国' : 'Global'}</dd>
        </div>
      ) : null}
      {item.miniMaxCli?.quotaLabel ? (
        <div className="plugin-details-metadata__row">
          <dt>套餐</dt>
          <dd>{item.miniMaxCli.quotaLabel}</dd>
        </div>
      ) : null}
    </dl>
  )
}

function miniMaxAuthLabel(status: NonNullable<PluginCatalogItem['miniMaxCli']>['authStatus']): string {
  if (status === 'coding-plan-synced') return '正在使用 API Key Hub 当前 Coding Plan Key'
  if (status === 'oauth') return '已通过 MiniMax 登录'
  if (status === 'api-key') return '已配置 MiniMax API Key'
  if (status === 'not-authenticated') return '尚未登录，实际使用时再登录'
  return '暂时无法确认'
}

export function PluginDetailsPrimaryAction({
  item,
  busy = false,
  onPrimaryAction,
}: ActionProps): React.ReactNode {
  const action = pluginPrimaryAction(item)
  const toggleRef = useRef<HTMLButtonElement>(null)

  if (action.kind === 'toggle-plugin') {
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

  return (
    <Button
      color="secondary"
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
  )
}
