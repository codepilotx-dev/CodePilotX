import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { desktopClient } from '../../services/desktop-client/index.js'
import { withModelCatalogLoading } from '../../hooks/useModelCatalogLoading.js'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/types.js'
import {
  getModelDisplayLabel,
} from '../../modelPresets.js'
import { SettingsDropdown } from './SettingsDropdown.js'

function splitProviderModel(value: string): { providerID: string; id: string } | null {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return null
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) }
}

type ModelOption = { value: string; label: string; detail?: string }

type TaskModelKey =
  | 'smallFastModel'
  | 'fastModel'
  | 'defaultModel'
  | 'deepModel'
  | 'planExecutionModel'
  | 'reviewModel'

const TASK_MODEL_LABELS: Record<TaskModelKey, { label: string; description: string }> = {
  smallFastModel: {
    label: '快速模型',
    description: '用于标题、摘要、Hook、检索等轻量辅助任务；未配置时使用主模型。',
  },
  fastModel: {
    label: '快速任务模型',
    description:
      '用于低成本子任务、轻量 Agent 和辅助生成；未配置时使用主模型。',
  },
  defaultModel: {
    label: '默认任务模型',
    description:
      '用于常规 Agent、计划外的主力任务入口；未配置时使用主模型。',
  },
  deepModel: {
    label: '深度任务模型',
    description:
      '用于高质量推理、复杂修改和深度审查；未配置时使用主模型。',
  },
  planExecutionModel: {
    label: '计划执行模型',
    description: '批准计划后用于实施阶段；未配置时使用默认任务模型。',
  },
  reviewModel: {
    label: '权限审核模型（实验）',
    description:
      '仅用于 Shell 和工具权限的自动审核；自定义模型不兼容时会回退人工审批。',
  },
}

function formatModelDetail(
  modelID: string,
  metadata?: DesktopModelMetadata,
): string {
  if (!metadata) return ''
  const parts: string[] = []
  if (metadata.contextWindow) {
    parts.push(`上下文 ${formatCompactNumber(metadata.contextWindow)}`)
  }
  if (metadata.outputTokens) {
    parts.push(`输出 ${formatCompactNumber(metadata.outputTokens)}`)
  }
  if (metadata.reasoning) parts.push('推理')
  if (metadata.toolCall) parts.push('工具调用')
  if (metadata.vision) parts.push('视觉')
  return parts.join(' / ')
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return String(value)
}

export function TaskModelSelect({
  value,
  mainModel,
  taskModelKey,
  onChange,
}: {
  value: string
  mainModel: string
  taskModelKey: TaskModelKey
  onChange: (newValue: string) => void
}): React.ReactNode {
  const { label, description } = TASK_MODEL_LABELS[taskModelKey]

  const [providers, setProviders] = useState<DesktopModelProviderSummary[]>([])
  const [providerModels, setProviderModels] = useState<
    Record<string, string[]>
  >({})
  const [providerMetadata, setProviderMetadata] = useState<
    Record<string, Record<string, DesktopModelMetadata> | undefined>
  >({})
  const [loading, setLoading] = useState(false)

  // Load all providers
  useEffect(() => {
    let cancelled = false
    desktopClient
      .listModelProviders()
      .then(provs => {
        if (!cancelled) setProviders(provs)
      })
      .catch(() => {
        // ignore — dropdown will show empty options
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch catalogs for all apiKeyConfigured providers
  useEffect(() => {
    if (providers.length === 0) return
    const configured = providers.filter(p => p.apiKeyConfigured)
    if (configured.length === 0) return

    let cancelled = false
    setLoading(true)

    void (async () => {
      const models: Record<string, string[]> = {}
      const metadata: Record<
        string,
        Record<string, DesktopModelMetadata> | undefined
      > = {}
      for (const provider of configured) {
        try {
          const result = await withModelCatalogLoading(() =>
            desktopClient.fetchProviderModels({
              providerID: provider.providerID as ModelProviderID,
              apiKey: undefined,
              baseURL: provider.baseURL,
            }),
          )
          if (cancelled) return
          models[provider.providerID] = result.models
          metadata[provider.providerID] = result.modelMetadata
        } catch {
          // ignore — individual provider failures don't break the whole list
        }
      }
      if (!cancelled) {
        setProviderModels(models)
        setProviderMetadata(metadata)
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [providers])

  const parsedValue = useMemo(() => splitProviderModel(value), [value])

  const options = useMemo<ModelOption[]>(() => {
    const inheritedLabel = mainModel
      ? `使用主模型 (${mainModel})`
      : '使用主模型'
    const opts: ModelOption[] = [
      { value: '', label: inheritedLabel, detail: '继承会话主模型' },
    ]

    // Add options from fetched catalogs
    for (const provider of providers) {
      const models = providerModels[provider.providerID]
      if (!models || models.length === 0) continue
      for (const modelID of models) {
        if (opts.length >= 100) break
        const fullValue = `${provider.providerID}/${modelID}`
        const meta = providerMetadata[provider.providerID]?.[modelID]
        opts.push({
          value: fullValue,
          label: getModelDisplayLabel(modelID),
          detail: `${provider.displayName}${meta ? ` · ${formatModelDetail(modelID, meta)}` : ''}`,
        })
      }
      if (opts.length >= 100) break
    }

    // Append saved value if it doesn't exist in any catalog
    if (
      value &&
      !opts.some(o => o.value === value) &&
      !opts.some(o => o.value === parsedValue?.id)
    ) {
      const savedMeta = parsedValue?.providerID
        ? providerMetadata[parsedValue.providerID]?.[parsedValue.id]
        : undefined
      opts.push({
        value,
        label: getModelDisplayLabel(parsedValue?.id ?? value),
        detail: `当前保存${parsedValue?.providerID ? ` · ${parsedValue.providerID}` : ''}`,
      })
    }

    return opts
  }, [
    mainModel,
    providers,
    providerModels,
    providerMetadata,
    value,
    parsedValue,
  ])

  const displayValue = useMemo(() => {
    if (!value) return ''
    return options.some(o => o.value === value) ? value : ''
  }, [value, options])

  const handleChange = useCallback(
    (newValue: string) => {
      onChange(newValue)
    },
    [onChange],
  )

  return (
    <SettingsDropdown
      width={360}
      ariaLabel={label}
      value={displayValue}
      options={options}
      onChange={handleChange}
    />
  )
}
