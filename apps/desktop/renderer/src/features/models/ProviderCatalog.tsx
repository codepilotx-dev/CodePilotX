import { Link2, Server } from 'lucide-react'
import type React from 'react'
import type { ModelProviderID } from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { RemoteImage } from '../../components/ui/RemoteImage.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'

export type ProviderCatalogStatusTone = 'positive' | 'warning' | 'danger' | 'neutral'

export type ProviderCatalogItem = {
  id: ModelProviderID
  name: string
  logoURL?: string
  source: string
  modelCount: number
  current: boolean
  canAddConnection: boolean
  status: {
    label: string
    tone: ProviderCatalogStatusTone
  }
}

export type ProviderCatalogProps = {
  providers: readonly ProviderCatalogItem[]
  query: string
  onQueryChange: (query: string) => void
  onSelect: (providerId: ModelProviderID) => void
  onAddConnection: (providerId: ModelProviderID) => void
  onManageConnection: (providerId: ModelProviderID) => void
}

export function ProviderCatalog({
  providers,
  query,
  onQueryChange,
  onSelect,
  onAddConnection,
  onManageConnection,
}: ProviderCatalogProps): React.ReactNode {
  return (
    <section className="model-center-catalog" aria-label="供应商目录">
      <div className="model-center-catalog-toolbar">
        <SearchInput
          aria-label="搜索 Provider"
          className="model-center-catalog-search"
          onChange={onQueryChange}
          placeholder="搜索 Provider、ID 或配置来源"
          value={query}
        />
        <span className="model-center-catalog-count">{providers.length} 个</span>
      </div>

      {providers.length === 0 ? (
        <div className="model-center-catalog-empty">
          <Server aria-hidden size={APP_ICON_SIZE + 4} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <strong>没有匹配的 Provider</strong>
          <span>尝试缩短关键词或清空搜索。</span>
        </div>
      ) : (
        <div className="model-center-catalog-list">
          {providers.map(provider => (
            <article
              className="provider-card"
              data-current={provider.current || undefined}
              key={provider.id}
            >
              <button
                aria-current={provider.current ? 'page' : undefined}
                className="provider-card-main"
                type="button"
                onClick={() => onSelect(provider.id)}
              >
                {provider.logoURL ? (
                  <RemoteImage
                    alt=""
                    className="provider-card-logo"
                    fallback={(
                      <Server
                        aria-hidden
                        size={APP_ICON_SIZE + 4}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                    )}
                    src={provider.logoURL}
                  />
                ) : (
                  <span className="provider-card-logo">
                    <Server
                      aria-hidden
                      size={APP_ICON_SIZE + 4}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </span>
                )}
                <span className="provider-card-copy">
                  <span className="provider-card-heading">
                    <strong>{provider.name}</strong>
                    {provider.current ? <span className="provider-card-current">当前</span> : null}
                  </span>
                  <span className="provider-card-meta">
                    <span>{provider.id} · {provider.source}</span>
                    <span>{provider.modelCount} 个模型</span>
                  </span>
                </span>
                <span
                  className="provider-card-status"
                  data-tone={provider.status.tone}
                >
                  {provider.status.label}
                </span>
              </button>
              <Button
                className="provider-card-connection-action"
                onClick={() => (
                  provider.canAddConnection
                    ? onAddConnection(provider.id)
                    : onManageConnection(provider.id)
                )}
              >
                <Link2
                  aria-hidden
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                {provider.canAddConnection ? '连接' : '账户连接'}
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
