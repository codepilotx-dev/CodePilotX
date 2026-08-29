import type React from 'react'
import { ExternalLink, Plus, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { DesktopSkillCatalogItem } from '../../../shared/types.js'
import { PluginDetailsMetadata, PluginDetailsPrimaryAction } from './PluginDetailsContent.js'
import { PluginIcon } from './PluginIcon.js'
import type { PluginCatalogItem } from './pluginCatalog.js'

const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download'

type PluginProps = {
  kind: 'plugin'
  item: PluginCatalogItem
  busy: boolean
  error?: string | null
  onPrimaryAction: (
    item: PluginCatalogItem,
    trigger: HTMLButtonElement,
    checked?: boolean,
  ) => void
  onUninstall?: () => void
}

type SkillProps = {
  kind: 'skill'
  item: DesktopSkillCatalogItem
  installing: boolean
  onInstall: (skill: DesktopSkillCatalogItem) => void
  onOpenSource: (skill: DesktopSkillCatalogItem) => void
}

export function CatalogDetailsView(props: PluginProps | SkillProps): React.ReactNode {
  const { item } = props
  const isPlugin = props.kind === 'plugin'

  return (
    <section className="catalog-details-view">
      <header className="catalog-details-view__header">
        <span
          aria-hidden="true"
          className="catalog-details-view__icon"
          data-plugin-tone={isPlugin ? props.item.tone : undefined}
        >
          {isPlugin ? (
            <PluginIcon
              logoDarkSource={props.item.logoDarkSource}
              logoSource={props.item.logoSource}
              name={props.item.iconName}
            />
          ) : (
            <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          )}
        </span>
        <div className="catalog-details-view__identity">
          <h1>{item.name}</h1>
          <p>{isPlugin ? props.item.description : props.item.source}</p>
        </div>
        <div className="catalog-details-view__primary-action">
          {isPlugin ? (
            <>
              <PluginDetailsPrimaryAction
                busy={props.busy}
                item={props.item}
                onPrimaryAction={props.onPrimaryAction}
              />
              {props.item.id === 'minimax' && props.item.installed && props.onUninstall ? (
                <Button color="secondary" disabled={props.busy} onClick={props.onUninstall}>
                  卸载
                </Button>
              ) : null}
            </>
          ) : props.item.installed ? (
            <span className="catalog-details-view__installed">已添加</span>
          ) : (
            <Button
              color="secondary"
              loading={props.installing}
              onClick={() => props.onInstall(props.item)}
            >
              <Plus aria-hidden="true" size={APP_ICON_SIZE} />
              添加
            </Button>
          )}
        </div>
      </header>

      <div className="catalog-details-view__body">
        <section aria-labelledby="catalog-details-overview" className="catalog-details-section">
          <h2 id="catalog-details-overview">概览</h2>
          {isPlugin ? (
            <PluginDetailsMetadata item={props.item} />
          ) : (
            <SkillDetailsMetadata item={props.item} />
          )}
          {isPlugin && props.error ? (
            <p className="catalog-details-view__error" role="status">
              {props.error}
            </p>
          ) : null}
        </section>

        {!isPlugin ? (
          <section aria-labelledby="catalog-details-audit" className="catalog-details-section">
            <h2 id="catalog-details-audit">安全审计</h2>
            {props.item.audit ? (
              <dl className="plugin-details-metadata">
                <div className="plugin-details-metadata__row">
                  <dt>结果</dt>
                  <dd>{skillAuditLabel(props.item.audit.status)}</dd>
                </div>
                <div className="plugin-details-metadata__row">
                  <dt>摘要</dt>
                  <dd>{props.item.audit.summary}</dd>
                </div>
                <div className="plugin-details-metadata__row">
                  <dt>Provider</dt>
                  <dd>{props.item.audit.providerCount}</dd>
                </div>
                {props.item.audit.auditedAt ? (
                  <div className="plugin-details-metadata__row">
                    <dt>审计时间</dt>
                    <dd>{new Date(props.item.audit.auditedAt).toLocaleString()}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="catalog-details-section__empty">该目录条目未提供审计信息。</p>
            )}
          </section>
        ) : null}

        {!isPlugin && props.item.url ? (
          <div className="catalog-details-view__secondary-action">
            <Button color="secondary" onClick={() => props.onOpenSource(props.item)}>
              打开来源页面
              <ExternalLink
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
          </div>
        ) : null}
        {isPlugin && props.item.id === 'minimax' && props.item.externalURL ? (
          <div className="catalog-details-view__secondary-action">
            {props.item.miniMaxCli?.installationStatus === 'missing-prerequisite' ? (
              <Button color="secondary" onClick={() => void desktopClient.openExternalURL(NODE_DOWNLOAD_URL)}>
                下载 Node.js
                <ExternalLink aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            ) : null}
            <Button color="secondary" onClick={() => void desktopClient.openExternalURL(props.item.externalURL!)}>
              查看官方说明
              <ExternalLink aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function SkillDetailsMetadata({
  item,
}: {
  item: DesktopSkillCatalogItem
}): React.ReactNode {
  return (
    <dl className="plugin-details-metadata">
      <div className="plugin-details-metadata__row">
        <dt>来源</dt>
        <dd>{item.source}</dd>
      </div>
      <div className="plugin-details-metadata__row">
        <dt>来源类型</dt>
        <dd>{item.sourceType}</dd>
      </div>
      <div className="plugin-details-metadata__row">
        <dt>安装量</dt>
        <dd>{item.installs.toLocaleString()}</dd>
      </div>
      <div className="plugin-details-metadata__row">
        <dt>状态</dt>
        <dd>{item.installed ? '已添加' : '未添加'}</dd>
      </div>
    </dl>
  )
}

function skillAuditLabel(status: 'pass' | 'warn' | 'fail'): string {
  if (status === 'pass') return '通过'
  if (status === 'warn') return '需要注意'
  return '未通过'
}
