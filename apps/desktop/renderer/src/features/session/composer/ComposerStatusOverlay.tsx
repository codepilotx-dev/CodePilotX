import type React from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ChatInputDropdown } from './ChatInputDropdown.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import {
  clampPercent,
  criticalQuotaWindows,
  formatCount,
  formatResetTime,
  protocolProviderId,
  quotaRemainingPercent,
  sourceForProvider,
  type ProviderQuotaWindow,
  type ProviderUsageSource,
} from '../../../utils/usageFormatters.js'
import type {
  DesktopContextUsage,
  ModelProviderID,
} from '../../../../shared/types.js'

type Props = {
  open: boolean
  onClose: () => void
  routedSessionId: string | null
  contextUsage: DesktopContextUsage | null
  selectedProviderID?: ModelProviderID
  side?: 'top' | 'bottom'
  disableOutsideDismiss?: boolean
}

function renderQuotaRow(quota: ProviderQuotaWindow): React.ReactNode {
  const percent = quotaRemainingPercent(quota)
  return (
    <div className="composer-status-quota-row" key={quota.id}>
      <div className="composer-status-label">{quota.label}</div>
      <div className="composer-status-bar-track">
        <div
          className="composer-status-bar-fill"
          style={
            { '--usage-ratio': percent / 100 } as React.CSSProperties
          }
        />
      </div>
      <div className="composer-status-bar-meta">
        <span className="composer-status-bar-percent">
          {quota.state === 'unlimited' ? '无限' : `${percent}%`}
        </span>
        <span className="composer-status-bar-detail">
          {quota.remaining !== undefined
            ? `剩余 ${formatCount(quota.remaining)} ${quota.unit === 'tokens' ? 'Token' : '额度'}`
            : ''}
          {quota.resetsAt !== undefined
            ? ` · ${formatResetTime(quota.resetsAt)}`
            : ''}
        </span>
      </div>
    </div>
  )
}

export function ComposerStatusOverlay({
  open,
  onClose,
  routedSessionId,
  contextUsage,
  selectedProviderID,
  side = 'top',
  disableOutsideDismiss = false,
}: Props): React.ReactNode {
  const [usageSource, setUsageSource] = useState<ProviderUsageSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !selectedProviderID) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setUsageSource(null)

    desktopClient
      .queryProviderUsage({
        range: '7d',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        providerIds: [protocolProviderId(selectedProviderID)],
      })
      .then(result => {
        if (!cancelled) {
          const source = sourceForProvider(result.sources, selectedProviderID) ?? null
          setUsageSource(source)
          setLoading(false)
          setError(source?.error?.message ?? null)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, selectedProviderID])

  if (!open) return null
  const quotas = criticalQuotaWindows(usageSource, 3)

  return (
    <ChatInputDropdown
      open={open}
      onClose={onClose}
      side={side}
      width="100%"
      maxWidth="100%"
      disableOutsideDismiss={disableOutsideDismiss}
    >
      <div className="composer-status-content">
        {/* Header */}
        <div className="composer-status-header">
          <span className="composer-status-title">状态</span>
          <button
            className="composer-status-close"
            onClick={onClose}
            type="button"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>

        {/* Session ID */}
        <div className="composer-status-section">
          <div className="composer-status-label">会话 ID</div>
          <div className="composer-status-value">
            {routedSessionId ?? '尚未创建会话'}
          </div>
        </div>

        {/* Context Usage */}
        <div className="composer-status-section">
          <div className="composer-status-label">上下文用量</div>
          {contextUsage ? (
            <>
              <div className="composer-status-bar-track">
                <div
                  className="composer-status-bar-fill"
                  style={
                    { '--usage-ratio': clampPercent(contextUsage.usedPercent) / 100 } as React.CSSProperties
                  }
                />
              </div>
              <div className="composer-status-bar-meta">
                <span className="composer-status-bar-percent">
                  {Math.round(contextUsage.usedPercent)}%
                </span>
                <span className="composer-status-bar-detail">
                  {contextUsage.usedTokens.toLocaleString()} /{' '}
                  {contextUsage.contextWindow.toLocaleString()}
                </span>
              </div>
            </>
          ) : (
            <div className="composer-status-empty">暂无上下文统计</div>
          )}
        </div>

        {/* Quota section */}
        {selectedProviderID ? (
          <div className="composer-status-section">
            {loading ? (
              <div className="composer-status-empty">正在查询用量...</div>
            ) : error ? (
              <div className="composer-status-empty composer-status-empty-error">
                {error}
              </div>
            ) : quotas.length > 0 ? (
              quotas.map(renderQuotaRow)
            ) : (
              <div className="composer-status-empty">
                当前提供商未返回用量数据
              </div>
            )}
          </div>
        ) : null}
      </div>
    </ChatInputDropdown>
  )
}
