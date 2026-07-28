import { ArrowLeft, Server } from 'lucide-react'
import type React from 'react'
import { useId, useRef } from 'react'
import type { ModelProviderID } from '../../../shared/types.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { RemoteImage } from '../../components/ui/RemoteImage.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'

export const PROVIDER_DETAIL_TABS = ['connection', 'models', 'router'] as const
export type ProviderDetailTab = (typeof PROVIDER_DETAIL_TABS)[number]
export type ProviderDetailStatusTone = 'positive' | 'warning' | 'danger' | 'neutral'

export type ProviderDetailIdentity = {
  id: ModelProviderID
  name: string
  logoURL?: string
  description?: string
  status: {
    label: string
    tone: ProviderDetailStatusTone
  }
}

export type ProviderDetailProps = {
  provider: ProviderDetailIdentity
  activeTab: ProviderDetailTab
  onTabChange: (tab: ProviderDetailTab) => void
  onBack?: () => void
  actions?: React.ReactNode
  feedback?: React.ReactNode
  children: React.ReactNode
}

const TAB_LABELS: Record<ProviderDetailTab, string> = {
  connection: '连接',
  models: '模型',
  router: 'Router',
}

export function ProviderDetail({
  provider,
  activeTab,
  onTabChange,
  onBack,
  actions,
  feedback,
  children,
}: ProviderDetailProps): React.ReactNode {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const titleId = useId()
  const panelId = useId()

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % PROVIDER_DETAIL_TABS.length
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + PROVIDER_DETAIL_TABS.length) % PROVIDER_DETAIL_TABS.length
    }
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = PROVIDER_DETAIL_TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = PROVIDER_DETAIL_TABS[nextIndex]
    if (!nextTab) return
    onTabChange(nextTab)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <section className="model-center-provider-detail" aria-labelledby={titleId}>
      <header className="model-center-provider-detail-header">
        {onBack ? (
          <IconButton
            className="model-center-provider-back"
            title="返回 Provider 列表"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
        ) : null}

        <div className="model-center-provider-identity">
          {provider.logoURL ? (
            <RemoteImage
              alt=""
              className="model-center-provider-identity-logo"
              fallback={(
                <Server
                  aria-hidden
                  size={APP_ICON_SIZE + 6}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              )}
              src={provider.logoURL}
            />
          ) : (
            <span className="model-center-provider-identity-logo">
              <Server
                aria-hidden
                size={APP_ICON_SIZE + 6}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
          )}
          <div className="model-center-provider-identity-copy">
            <div className="model-center-provider-identity-heading">
              <h2 id={titleId}>{provider.name}</h2>
              <span
                className="model-center-provider-status"
                data-tone={provider.status.tone}
              >
                {provider.status.label}
              </span>
            </div>
            <p>{provider.description ?? provider.id}</p>
          </div>
        </div>

        {actions ? <div className="model-center-provider-context-actions">{actions}</div> : null}
      </header>

      <nav className="model-center-provider-tabs" aria-label="Provider 详情" role="tablist">
        {PROVIDER_DETAIL_TABS.map((tab, index) => (
          <button
            aria-controls={panelId}
            aria-selected={activeTab === tab}
            className="model-center-provider-tab"
            id={`${panelId}-tab-${tab}`}
            key={tab}
            ref={element => { tabRefs.current[index] = element }}
            role="tab"
            tabIndex={activeTab === tab ? 0 : -1}
            type="button"
            onClick={() => onTabChange(tab)}
            onKeyDown={event => handleTabKeyDown(event, index)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </nav>

      {feedback ? (
        <div className="model-center-provider-feedback" role="status">{feedback}</div>
      ) : null}

      <div
        aria-labelledby={`${panelId}-tab-${activeTab}`}
        className="model-center-provider-panel"
        id={panelId}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  )
}
