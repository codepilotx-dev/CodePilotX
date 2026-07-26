import { KeyRound, Plus, Search, Server } from 'lucide-react'
import type React from 'react'
import type { ModelProviderID } from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
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
  onAddKey: (providerId: ModelProviderID) => void
}

export function ProviderCatalog({
  providers,
  query,
  onQueryChange,
  onSelect,
  onAddKey,
}: ProviderCatalogProps): React.ReactNode {
  return (
    <section className="model-center-catalog" aria-label="Provider 目录">
      <header className="model-center-catalog-header">
        <div>
          <h2>Provider</h2>
          <p>选择供应商并管理连接、模型与 Router。</p>
        </div>
        <span className="model-center-catalog-count">{providers.length} 个</span>
      </header>

      <label className="model-center-catalog-search">
        <Search
          aria-hidden
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
        <Input
          aria-label="搜索 Provider"
          placeholder="搜索 Provider、ID、package 或目录来源"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
        />
      </label>

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
                aria-label={`为 ${provider.name} 添加 API Key`}
                className="provider-card-add-key"
                size="icon"
                title="添加 API Key"
                variant="ghost"
                onClick={() => onAddKey(provider.id)}
              >
                <KeyRound aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                <Plus aria-hidden className="provider-card-add-mark" />
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
