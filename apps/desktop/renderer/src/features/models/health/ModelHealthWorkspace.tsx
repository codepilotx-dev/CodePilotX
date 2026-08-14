import { Activity, RotateCw, X } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { Button } from '../../../components/ui/Button.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { useProviderManagementSnapshot } from '../../provider-management/index.js'
import { SettingsDropdown } from '../../settings/SettingsDropdown.js'
import {
  filterModelHealthItems,
  isModelHealthRunActive,
  MODEL_HEALTH_STATUS_LABELS,
  type ModelHealthFilter,
  type ModelHealthItem,
} from './modelHealthState.js'
import type { ModelHealthController } from './useModelHealthController.js'

type Props = {
  controller: ModelHealthController
}

const FAILURE_CATEGORY_LABELS: Record<string, string> = {
  authentication: '鉴权失败',
  configuration: '配置不可用',
  network: '网络错误',
  'rate-limit': '请求受限',
  timeout: '请求超时',
  provider: 'Provider 错误',
  unknown: '未知错误',
}

const EXCLUDED_REASON_LABELS: Record<string, string> = {
  'provider-disabled': '已停用',
  'provider-unconfigured': '未配置可用模型',
  'no-eligible-models': '无可用模型',
}

const modelKey = (model: ModelHealthItem['model']): string =>
  `${String(model.providerID)}/${String(model.id)}${model.variant ? `/${String(model.variant)}` : ''}`

export function ModelHealthWorkspace({
  controller,
}: Props): React.ReactNode {
  const snapshot = useProviderManagementSnapshot()
  const [filter, setFilter] = useState<ModelHealthFilter>({
    query: '',
    providerId: null,
    status: null,
  })
  const run = controller.state.run
  const runActive = run !== null && isModelHealthRunActive(run.status)
  const counts = run?.counts
  const finished = counts
    ? counts.healthy + counts.failed + counts.cancelled
    : 0
  const progress = counts && counts.total > 0
    ? Math.round((finished / counts.total) * 100)
    : 0

  const providerNames = useMemo(() => new Map(
    snapshot.providers.map(provider => [provider.providerID, provider.displayName]),
  ), [snapshot.providers])

  const providerOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const item of run?.items ?? []) {
      ids.add(String(item.model.providerID))
    }
    return [
      { value: '', label: '全部 Provider' },
      ...[...ids].sort().map(id => ({
        value: id,
        label: providerNames.get(id as never) ?? id,
      })),
    ]
  }, [providerNames, run?.items])

  const statusOptions = useMemo(() => [
    { value: '', label: '全部状态' },
    ...Object.entries(MODEL_HEALTH_STATUS_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  ], [])

  const visibleItems = useMemo(() => (
    run ? filterModelHealthItems(run.items, filter) : []
  ), [filter, run])

  return (
    <div className="model-health-workspace">
      {controller.notice ? (
        <div className="model-health-notice" role="status">
          <span>{controller.notice}</span>
          <IconButton
            color="ghostSecondary"
            onClick={controller.dismissNotice}
            size="iconSm"
            title="关闭提示"
          >
            <X aria-hidden />
          </IconButton>
        </div>
      ) : null}

      <section className="model-center-detail-section model-health-summary">
        <header className="model-center-detail-section-heading">
          <div>
            <h3>测试摘要</h3>
            <p>每个模型会产生一次最小文本请求（最多 8 个输出 token），仅使用当前活动凭据。</p>
          </div>
          <span>{counts ? `${finished}/${counts.total} 已完成` : '尚未开始'}</span>
        </header>
        {counts ? (
          <>
            <div className="model-health-summary-stats">
              <span>总数 <strong>{counts.total}</strong></span>
              <span>健康 <strong>{counts.healthy}</strong></span>
              <span>失败 <strong>{counts.failed}</strong></span>
              <span>取消 <strong>{counts.cancelled}</strong></span>
            </div>
            <div
              aria-label={`测试进度 ${progress}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progress}
              className="model-health-progress-track"
              role="progressbar"
            >
              <div
                className="model-health-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        ) : (
          <div className="model-health-empty">
            <Activity aria-hidden />
            <p>尚未测试任何模型。</p>
            <p className="model-health-empty-hint">点击右上角“测试全部模型”开始，结果只保留在当前页面。</p>
          </div>
        )}
      </section>

      {run && run.excludedProviders.length > 0 ? (
        <p className="model-health-excluded">
          已排除 {run.excludedProviders.length} 个 Provider：
          {run.excludedProviders.map(entry => (
            <span key={String(entry.providerId)}>
              {providerNames.get(entry.providerId as never) ?? String(entry.providerId)}
              （{EXCLUDED_REASON_LABELS[entry.reason] ?? entry.reason}）
            </span>
          ))}
        </p>
      ) : null}

      {run ? (
        <>
          <div className="model-health-toolbar">
            <SearchInput
              aria-label="搜索模型"
              className="model-health-search"
              onChange={query => setFilter(current => ({ ...current, query }))}
              placeholder="搜索 Provider 或模型 ID"
              value={filter.query ?? ''}
              variant="standard"
            />
            <SettingsDropdown
              ariaLabel="按 Provider 筛选"
              onChange={providerId => setFilter(current => ({
                ...current,
                providerId: providerId || null,
              }))}
              options={providerOptions}
              value={filter.providerId ?? ''}
              width={220}
            />
            <SettingsDropdown
              ariaLabel="按状态筛选"
              onChange={status => setFilter(current => ({
                ...current,
                status: status === '' ? null : status as ModelHealthItem['status'],
              }))}
              options={statusOptions}
              value={filter.status ?? ''}
              width={160}
            />
          </div>
          <div className="model-health-list">
            {visibleItems.length === 0 ? (
              <div className="model-center-empty-state">
                {run.items.length === 0
                  ? '没有已启用且已配置凭据的模型。'
                  : '没有匹配筛选条件的模型。'}
              </div>
            ) : visibleItems.map(item => (
              <ModelHealthRow
                disabled={runActive || controller.busy}
                key={modelKey(item.model)}
                item={item}
                providerName={providerNames.get(item.model.providerID as never) ?? String(item.model.providerID)}
                onRetry={() => void controller.retestItem(item.model)}
              />
            ))}
          </div>
        </>
      ) : null}

      {controller.confirm ? (
        <ConfirmationDialog
          actionDisabled={controller.confirm.busy}
          actionLabel="开始测试"
          description={`将向 ${controller.confirm.totalRequests} 个模型各发送 1 次最小文本请求，每次最多生成 8 个输出 token。\n请求可能产生费用；停用或未配置的 Provider 不会参与。`}
          onAction={() => void controller.confirmStart()}
          onCancel={controller.dismissConfirm}
          open={controller.confirm.open}
          title="测试全部模型？"
        />
      ) : null}
    </div>
  )
}

function ModelHealthRow({
  disabled,
  item,
  providerName,
  onRetry,
}: {
  disabled: boolean
  item: ModelHealthItem
  providerName: string
  onRetry: () => void
}): React.ReactNode {
  const retryable = item.status === 'failed' || item.status === 'cancelled'
  return (
    <article className="model-health-row">
      <div className="model-health-row-main">
        <div className="model-health-row-title">
          <span>{providerName}</span>
          <code>{String(item.model.id)}</code>
          {item.model.variant ? <em>{String(item.model.variant)}</em> : null}
        </div>
        <div className="model-health-row-meta">
          <span className={`model-health-status model-health-status--${item.status}`}>
            {MODEL_HEALTH_STATUS_LABELS[item.status]}
          </span>
          {item.status === 'healthy' ? (
            <span className="model-health-latency">延迟 {item.latencyMs} ms</span>
          ) : null}
          {item.status === 'failed' ? (
            <span className="model-health-failure">
              {FAILURE_CATEGORY_LABELS[item.category] ?? item.category}：{item.message}
            </span>
          ) : null}
        </div>
      </div>
      {retryable ? (
        <Button
          color="secondary"
          disabled={disabled}
          onClick={onRetry}
          size="compact"
        >
          <RotateCw aria-hidden />
          重试
        </Button>
      ) : null}
    </article>
  )
}
