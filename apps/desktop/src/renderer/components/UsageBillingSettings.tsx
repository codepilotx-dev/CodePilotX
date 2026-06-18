import { desktopClient } from '../services/desktopClient.js'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { DesktopProviderBalanceResult } from '../../shared/types.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

export function UsageBillingSettings(): React.ReactNode {
  const [balance, setBalance] = useState<DesktopProviderBalanceResult | null>(
    null,
  )
  const [deepSeekConfigured, setDeepSeekConfigured] = useState<boolean | null>(
    null,
  )
  const [hasConfiguredProvider, setHasConfiguredProvider] = useState<
    boolean | null
  >(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshBalance = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const providers = await desktopClient.listModelProviders()
      setHasConfiguredProvider(
        providers.some(provider => provider.apiKeyConfigured),
      )
      const deepSeekProvider = providers.find(
        provider => provider.providerID === 'deepseek',
      )
      if (!deepSeekProvider?.apiKeyConfigured) {
        setDeepSeekConfigured(false)
        setBalance(null)
        return
      }
      setDeepSeekConfigured(true)
      const result = await desktopClient.fetchProviderBalance({
        providerID: 'deepseek',
      })
      setBalance(result)
      setError(result.error ?? null)
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : String(refreshError),
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  const summary = useMemo(() => formatBalanceSummary(balance, error), [
    balance,
    error,
  ])

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">使用情况和计费</h2>
        {hasConfiguredProvider === false ? (
          <SettingsSection
            title="暂未连接提供商"
            description="暂未连接提供商，无法获取使用情况和计费情况！"
          >
            <SettingsRow
              title="连接状态"
              description="请先到配置页连接模型提供商并保存 API key。"
              control={
                <button
                  className="settings-button"
                  disabled={loading}
                  type="button"
                  onClick={() => void refreshBalance()}
                >
                  重新检查
                </button>
              }
            />
          </SettingsSection>
        ) : deepSeekConfigured === false ? (
          <SettingsSection
            title="暂无可显示的计费信息"
            description="这里只显示已配置 API key 且支持余额查询的提供商。"
          >
            <SettingsRow
              title="DeepSeek"
              description="尚未配置 API key。配置后这里会显示 DeepSeek 余额。"
              control={
                <button
                  className="settings-button"
                  disabled={loading}
                  type="button"
                  onClick={() => void refreshBalance()}
                >
                  重新检查
                </button>
              }
            />
          </SettingsSection>
        ) : (
          <SettingsSection
            title="DeepSeek 余额"
            description="显示当前 DeepSeek API key 对应账户的可用余额。"
          >
            <SettingsRow
              title="账户状态"
              description={summary}
              control={
                <div className="settings-inline-actions">
                  <button
                    className="settings-button"
                    disabled={loading}
                    type="button"
                    onClick={() => void refreshBalance()}
                  >
                    {loading ? '刷新中...' : '刷新余额'}
                  </button>
                  <button
                    className="settings-button"
                    type="button"
                    onClick={() =>
                      void desktopClient.openExternalURL(
                        'https://platform.deepseek.com/usage',
                      )
                    }
                  >
                    打开控制台
                  </button>
                </div>
              }
            />
            {balance?.balances.length ? (
              <div className="billing-balance-list">
                {balance.balances.map(item => (
                  <article className="billing-balance-row" key={item.currency}>
                    <div>
                      <h4>{item.currency}</h4>
                      <p>总余额 {item.totalBalance}</p>
                    </div>
                    <dl>
                      <div>
                        <dt>赠送余额</dt>
                        <dd>{item.grantedBalance || '0'}</dd>
                      </div>
                      <div>
                        <dt>充值余额</dt>
                        <dd>{item.toppedUpBalance || '0'}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : null}
          </SettingsSection>
        )}
      </div>
    </div>
  )
}

function formatBalanceSummary(
  balance: DesktopProviderBalanceResult | null,
  error: string | null,
): string {
  if (error) {
    return error
  }
  if (!balance) {
    return '正在查询 DeepSeek 余额...'
  }
  if (balance.balances.length === 0) {
    return balance.isAvailable
      ? 'DeepSeek 账户可用，但接口未返回余额明细。'
      : 'DeepSeek 账户当前不可用。'
  }
  const balances = balance.balances
    .map(item => `${item.currency} ${item.totalBalance}`)
    .join('，')
  return balance.isAvailable
    ? `账户可用，余额：${balances}`
    : `余额不足或账户不可用：${balances}`
}
