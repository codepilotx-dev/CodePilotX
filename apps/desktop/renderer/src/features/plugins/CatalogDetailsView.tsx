import type { PluginDetails } from '@codepilotx/agent-protocol'
import type React from 'react'
import { ExternalLink, Plus, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { DesktopSkillCatalogItem } from '../../../shared/types.js'
import { PluginProductDetailsView } from './PluginProductDetailsView.js'
import type { PluginCatalogItem } from './pluginCatalog.js'

type PluginProps = {
  kind: 'plugin'
  item: PluginCatalogItem
  details: PluginDetails | null
  busy: boolean
  error?: string | null
  onPrimaryAction: (
    item: PluginCatalogItem,
    trigger: HTMLButtonElement,
    checked?: boolean,
  ) => void
  onTryPrompt: (prompt: string) => void
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
  if (props.kind === 'plugin') {
    return <PluginProductDetailsView {...props} />
  }

  const { item } = props

  return (
    <section className="catalog-details-view">
      <header className="catalog-details-view__header">
        <span
          aria-hidden="true"
          className="catalog-details-view__icon"
        >
          <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </span>
        <div className="catalog-details-view__identity">
          <h1>{item.name}</h1>
          <p>{props.item.source}</p>
        </div>
        <div className="catalog-details-view__primary-action">
          {props.item.installed ? (
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
          <SkillDetailsMetadata item={props.item} />
        </section>

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

        {props.item.url ? (
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
