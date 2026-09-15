import { Server } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import type { ModelProviderID } from '../../../shared/types.js'
import { RemoteImage } from '../../components/ui/RemoteImage.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'

export const PROVIDER_DETAIL_TABS = ['connection', 'models'] as const
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

const TAB_OPTIONS: ReadonlyArray<{ value: ProviderDetailTab; label: string }> = [
  { value: 'connection', label: '连接与凭据' },
  { value: 'models', label: '模型与测速' },
]

export function ProviderDetail({
  provider,
  activeTab,
  onTabChange,
  actions,
  feedback,
  children,
}: ProviderDetailProps): React.ReactNode {
  const panelId = useId()

  return (
    <section className="model-center-provider-detail" aria-label={`${provider.name} 详情`}>
      <header className="model-center-provider-detail-header">
        <div className="model-center-provider-identity">
          {provider.logoURL ? (
            <RemoteImage
              alt=""
              className="model-center-provider-identity-logo"
              fallback={(
                <Server
                  aria-hidden
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              )}
              src={provider.logoURL}
            />
          ) : (
            <span className="model-center-provider-identity-logo">
              <Server
                aria-hidden
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
          )}
          <div className="model-center-provider-identity-copy">
            <div className="model-center-provider-identity-heading">
              <h2>{provider.name}</h2>
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

      <div className="model-center-provider-tab-bar">
        <SegmentedControl<ProviderDetailTab>
          ariaLabel="供应商详情功能切换"
          className="model-center-provider-segmented-tabs"
          getPanelId={tab => `${panelId}-panel-${tab}`}
          getTabId={tab => `${panelId}-tab-${tab}`}
          onChange={onTabChange}
          options={TAB_OPTIONS}
          overflowMode="fit"
          semantics="tabs"
          value={activeTab}
        />
      </div>

      {feedback ? (
        <div className="model-center-provider-feedback" role="status">{feedback}</div>
      ) : null}

      <div
        aria-labelledby={`${panelId}-tab-${activeTab}`}
        className="model-center-provider-panel"
        id={`${panelId}-panel-${activeTab}`}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  )
}
