import type React from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ChatInputDropdown } from './ChatInputDropdown.js'
import { isBillingProviderID } from '../../utils/billingProviders.js'
import { desktopClient } from '../../services/desktopClient.js'
import { clampPercent, formatRemainingWindow } from '../../utils/providerBalanceUtils.js'
import type {
  DesktopContextUsage,
  DesktopProviderBalanceResult,
  ModelProviderID,
} from '../../../shared/types.js'

type Props = {
  open: boolean
  onClose: () => void
  routedSessionId: string | null
  contextUsage: DesktopContextUsage | null
  selectedProviderID?: ModelProviderID
  side?: 'top' | 'bottom'
  disableOutsideDismiss?: boolean
}

function renderQuotaRow(
  label: string,
  percent: number | null,
  remainingCount: number | null,
  endTime: number | null,
): React.ReactNode {
  return (
    <div className="composer-status-quota-row">
      <div className="composer-status-label">{label}</div>
      <div className="composer-status-bar-track">
        <div
          className="composer-status-bar-fill"
          style={
            { '--usage-ratio': clampPercent(percent ?? 0) / 100 } as React.CSSProperties
          }
        />
      </div>
      <div className="composer-status-bar-meta">
        <span className="composer-status-bar-percent">
          {clampPercent(percent ?? 0)}%
        </span>
        <span className="composer-status-bar-detail">
          {remainingCount != null
            ? `剩余 ${remainingCount.toLocaleString()} tokens`
            : ''}
          {endTime != null
            ? ` · ${formatRemainingWindow(null, endTime)}`
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
  const [balance, setBalance] = useState<DesktopProviderBalanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !selectedProviderID) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setBalance(null)

    if (!isBillingProviderID(selectedProviderID)) {
      setLoading(false)
      return
    }

    desktopClient
      .fetchProviderBalance({ providerID: selectedProviderID })
      .then(result => {
        if (!cancelled) {
          setBalance(result)
          setLoading(false)
          setError(result.error ?? null)
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
            {!isBillingProviderID(selectedProviderID) ? (
              <div className="composer-status-empty">当前提供商不支持用量查询</div>
            ) : loading ? (
              <div className="composer-status-empty">正在查询用量...</div>
            ) : error ? (
              <div className="composer-status-empty composer-status-empty-error">
                {error}
              </div>
            ) : balance?.tokenPlanUsages?.length ? (
              balance.tokenPlanUsages.map(usage => (
                <div key={usage.modelName}>
                  {renderQuotaRow(
                    '5 小时限额',
                    usage.currentIntervalRemainingPercent,
                    usage.currentIntervalRemainingCount,
                    usage.currentIntervalEndTime,
                  )}
                  {usage.currentWeeklyRemainingPercent != null
                    ? renderQuotaRow(
                        '7 天限额',
                        usage.currentWeeklyRemainingPercent,
                        usage.currentWeeklyRemainingCount,
                        usage.weeklyEndTime,
                      )
                    : null}
                </div>
              ))
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
