import {
  Activity,
  AlertCircle,
  Brain,
  Braces,
  CheckCircle2,
  Clock,
  Eye,
  Hammer,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useState, useMemo } from 'react'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  DesktopModelRef,
  ModelProviderID,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { Input } from '../../../components/ui/Input.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { fullErrorMessage } from '../../../utils/errors.js'

export type ModelTestStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'reachable'; latencyMs: number }
  | { state: 'failed'; message: string }

export type ProviderModelsSectionProps = {
  provider: DesktopModelProviderSummary
  models: readonly string[]
  modelMetadata?: Record<string, DesktopModelMetadata>
  busy: boolean
  onFetchModels: () => Promise<void>
  onNotice: (message: string) => void
  onError: (message: string) => void
}

export function ProviderModelsSection({
  provider,
  models,
  modelMetadata = {},
  busy,
  onFetchModels,
  onNotice,
  onError,
}: ProviderModelsSectionProps): React.ReactNode {
  const [searchQuery, setSearchQuery] = useState('')
  const [modelTestResults, setModelTestResults] = useState<Record<string, ModelTestStatus>>({})
  const [batchTesting, setBatchTesting] = useState(false)

  // Builtin provider allow/deny models configuration
  const builtinConfig = provider.config?.kind === 'builtin' ? provider.config : null
  const [allowModels, setAllowModels] = useState(builtinConfig?.allowModels.join(', ') ?? '')
  const [denyModels, setDenyModels] = useState(builtinConfig?.denyModels.join(', ') ?? '')
  const [savingBuiltinConfig, setSavingBuiltinConfig] = useState(false)

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return models.filter(modelId => {
      if (!query) return true
      const meta = modelMetadata[modelId]
      const searchText = [
        modelId,
        meta?.name,
        meta?.description,
        ...(meta?.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase()
      return searchText.includes(query)
    })
  }, [modelMetadata, models, searchQuery])

  async function testSingleModel(modelId: string): Promise<void> {
    setModelTestResults(prev => ({
      ...prev,
      [modelId]: { state: 'testing' },
    }))

    try {
      const ref = {
        providerID: provider.providerID,
        id: modelId,
      } as DesktopModelRef
      const result = await desktopClient.testModelProvider(provider.providerID, ref)
      if (result.status === 'reachable') {
        setModelTestResults(prev => ({
          ...prev,
          [modelId]: { state: 'reachable', latencyMs: result.latencyMs ?? 0 },
        }))
        onNotice(`模型“${modelId}”连通正常（${result.latencyMs} ms）。`)
      } else {
        const errorMsg = result.message ?? '连接失败'
        setModelTestResults(prev => ({
          ...prev,
          [modelId]: { state: 'failed', message: errorMsg },
        }))
        onError(`模型“${modelId}”测试失败：${errorMsg}`)
      }
    } catch (error) {
      const errorMsg = fullErrorMessage(error)
      setModelTestResults(prev => ({
        ...prev,
        [modelId]: { state: 'failed', message: errorMsg },
      }))
      onError(`模型“${modelId}”测试失败：${errorMsg}`)
    }
  }

  async function testAllModels(): Promise<void> {
    if (models.length === 0 || batchTesting) return
    setBatchTesting(true)
    onNotice(`开始对 ${models.length} 个模型执行连通测速...`)

    for (const modelId of models) {
      setModelTestResults(prev => ({
        ...prev,
        [modelId]: { state: 'testing' },
      }))
      try {
        const ref = {
          providerID: provider.providerID,
          id: modelId,
        } as DesktopModelRef
        const result = await desktopClient.testModelProvider(provider.providerID, ref)
        if (result.status === 'reachable') {
          setModelTestResults(prev => ({
            ...prev,
            [modelId]: { state: 'reachable', latencyMs: result.latencyMs ?? 0 },
          }))
        } else {
          setModelTestResults(prev => ({
            ...prev,
            [modelId]: { state: 'failed', message: result.message ?? '连接失败' },
          }))
        }
      } catch (error) {
        setModelTestResults(prev => ({
          ...prev,
          [modelId]: { state: 'failed', message: fullErrorMessage(error) },
        }))
      }
    }
    setBatchTesting(false)
    onNotice('供应商模型批量测速完成。')
  }

  async function handleSaveBuiltinFilter(): Promise<void> {
    if (!builtinConfig) return
    setSavingBuiltinConfig(true)
    try {
      const nextAllow = allowModels.split(',').map(s => s.trim()).filter(Boolean)
      const nextDeny = denyModels.split(',').map(s => s.trim()).filter(Boolean)
      await desktopClient.updateProvider(provider.providerID, {
        ...builtinConfig,
        allowModels: nextAllow as never,
        denyModels: nextDeny as never,
      })
      onNotice('模型筛选规则已保存。')
      await onFetchModels()
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setSavingBuiltinConfig(false)
    }
  }

  return (
    <div className="model-center-models-section">
      {/* 1. Builtin Provider Filter Configuration (if builtin) */}
      {builtinConfig ? (
        <section className="model-center-detail-card">
          <header className="model-center-detail-card-header">
            <div>
              <h3>内置模型可见性筛选</h3>
              <p>可按需允许或排除特定内置模型。</p>
            </div>
            <ToggleSwitch
              ariaLabel="启用该内置供应商"
              checked={builtinConfig.enabled}
              onChange={enabled => {
                void desktopClient
                  .updateProvider(provider.providerID, { ...builtinConfig, enabled })
                  .then(() => onNotice(enabled ? '供应商已启用' : '供应商已停用'))
                  .catch(err => onError(fullErrorMessage(err)))
              }}
            />
          </header>
          <div className="model-center-detail-card-body">
            <div className="model-center-detail-field-row">
              <label className="model-center-detail-field" style={{ flex: 1 }}>
                <span>允许模型（逗号分隔，留空表示全部）</span>
                <Input
                  placeholder="如: gpt-4o, gpt-4o-mini"
                  value={allowModels}
                  onChange={e => setAllowModels(e.target.value)}
                />
              </label>
              <label className="model-center-detail-field" style={{ flex: 1 }}>
                <span>排除模型（逗号分隔）</span>
                <Input
                  placeholder="如: o1-mini"
                  value={denyModels}
                  onChange={e => setDenyModels(e.target.value)}
                />
              </label>
              <Button
                color="secondary"
                disabled={savingBuiltinConfig}
                onClick={() => void handleSaveBuiltinFilter()}
              >
                保存筛选
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 2. Model Catalog & Speedtest Section */}
      <section className="model-center-detail-card">
        <header className="model-center-detail-card-header">
          <div className="model-center-catalog-toolbar" style={{ width: '100%', margin: 0 }}>
            <SearchInput
              aria-label="搜索模型"
              className="model-center-catalog-search"
              onChange={setSearchQuery}
              placeholder="搜索模型名称、ID 或能力..."
              value={searchQuery}
            />
            <span className="model-center-catalog-count">
              {filteredModels.length} / {models.length} 个模型
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--cpx-sys-space-2)' }}>
              <Button
                color="secondary"
                disabled={busy}
                onClick={() => void onFetchModels()}
                title="从供应商 API 拉取最新可用模型列表"
              >
                <RefreshCw aria-hidden size={APP_ICON_SIZE} className={busy ? 'spin' : undefined} />
                刷新目录
              </Button>
              <Button
                color="secondary"
                disabled={batchTesting || models.length === 0}
                onClick={() => void testAllModels()}
                title="逐个测速当前供应商的所有模型"
              >
                <Zap aria-hidden size={APP_ICON_SIZE} />
                {batchTesting ? '测速中...' : '测速全部模型'}
              </Button>
            </div>
          </div>
        </header>

        <div className="model-center-detail-card-body">
          {filteredModels.length === 0 ? (
            <div className="model-center-section-empty-hint">
              <Server aria-hidden size={24} />
              <span>
                {models.length === 0
                  ? '尚未获取到可用模型，请点击上方「刷新目录」同步供应商模型列表。'
                  : '未找到匹配的模型，请尝试更改搜索关键词。'}
              </span>
            </div>
          ) : (
            <div className="model-center-models-list">
              {filteredModels.map(modelId => {
                const meta = modelMetadata[modelId]
                const testStatus = modelTestResults[modelId] ?? { state: 'idle' }
                return (
                  <ModelRowItem
                    key={modelId}
                    modelId={modelId}
                    metadata={meta}
                    testStatus={testStatus}
                    onTest={() => void testSingleModel(modelId)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

type ModelRowItemProps = {
  modelId: string
  metadata?: DesktopModelMetadata
  testStatus: ModelTestStatus
  onTest: () => void
}

function ModelRowItem({
  modelId,
  metadata,
  testStatus,
  onTest,
}: ModelRowItemProps): React.ReactNode {
  const displayName = metadata?.name || modelId

  const contextLength = metadata?.contextWindow
    ? formatCompactNumber(metadata.contextWindow)
    : null
  const outputLength = metadata?.outputTokens
    ? formatCompactNumber(metadata.outputTokens)
    : null

  return (
    <article className="model-center-model-row">
      <div className="model-center-model-main">
        <div className="model-center-model-title">
          <strong>{displayName}</strong>
          <code>{modelId}</code>
        </div>
        <div className="model-center-model-caps">
          {contextLength ? (
            <span className="model-cap-pill" title={`最大上下文长度：${metadata?.contextWindow} tokens`}>
              <Clock aria-hidden size={12} />
              {contextLength} 上下文
            </span>
          ) : null}
          {outputLength ? (
            <span className="model-cap-pill" title={`最大输出长度：${metadata?.outputTokens} tokens`}>
              {outputLength} 输出
            </span>
          ) : null}
          {metadata?.reasoning ? (
            <span className="model-cap-pill model-cap-pill--highlight" title="支持思考/推理过程">
              <Brain aria-hidden size={12} />
              推理
            </span>
          ) : null}
          {metadata?.toolCall ? (
            <span className="model-cap-pill" title="支持 Function Calling 工具调用">
              <Hammer aria-hidden size={12} />
              工具
            </span>
          ) : null}
          {metadata?.vision ? (
            <span className="model-cap-pill" title="支持图片/多模态视觉输入">
              <Eye aria-hidden size={12} />
              视觉
            </span>
          ) : null}
          {metadata?.structuredOutput ? (
            <span className="model-cap-pill" title="支持结构化 JSON Schema 输出">
              <Braces aria-hidden size={12} />
              结构化
            </span>
          ) : null}
        </div>
      </div>

      <div className="model-center-model-actions">
        {/* Speedtest Status Feedback */}
        {testStatus.state === 'testing' ? (
          <span className="model-speed-status model-speed-status--testing">
            <Loader2 aria-hidden size={13} className="spin" />
            测速中...
          </span>
        ) : testStatus.state === 'reachable' ? (
          <span className="model-speed-status model-speed-status--healthy" title={`响应耗时 ${testStatus.latencyMs} 毫秒`}>
            <CheckCircle2 aria-hidden size={13} />
            {testStatus.latencyMs} ms
          </span>
        ) : testStatus.state === 'failed' ? (
          <span className="model-speed-status model-speed-status--failed" title={testStatus.message}>
            <AlertCircle aria-hidden size={13} />
            测速失败
          </span>
        ) : null}

        <Button
          color="secondary"
          disabled={testStatus.state === 'testing'}
          onClick={onTest}
          title="发送最小请求测试此模型的连通性与延迟"
        >
          <Activity aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          测速
        </Button>
      </div>
    </article>
  )
}

function formatCompactNumber(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}
