import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Plus,
  Search,
  X,
} from 'lucide-react'
import type { ModelProviderID } from '../../../../shared/types.js'
import { modelsDevLogoURL } from '../../../services/desktop-client/provider-adapters.js'
import type { ModelPreset } from '../../../modelPresets.js'
import {
  resolveThinkingLabel,
  resolveThinkingOptions,
  type ThinkingOption,
} from './ThinkingLevelPopover.js'
import { ProviderLogo } from './providerLogos.js'

export type ProviderModelOption = {
  providerID: ModelProviderID
  displayName: string
  modelPresets: ModelPreset[]
  logoURL?: string
}

export type ModelPickerPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactElement
  selectedProviderID?: ModelProviderID
  selectedModelPreset?: string
  providerOptions: ProviderModelOption[]
  deepSeekThinkingControls: boolean
  showThinkingOptions: boolean
  thinkingMode: string
  thinkingPreviewMode?: string | null
  thinkingOptions: ThinkingOption[]
  onThinkingChange: (mode: string) => void
  onThinkingPreviewChange?: (mode: string | null) => void
  onProviderModelChange: (providerID: ModelProviderID, modelID: string) => void
  onProviderOpen?: (providerID: ModelProviderID) => void
  onProviderSearch?: (providerID: ModelProviderID, query: string) => void
  onOpenModelSettings?: () => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

type HubProviderItem = {
  id: string
  name: string
  desc: string
  category: string
}

// Catalogue mirror of the providers models.dev exposes, used by the Model Hub
// view. Selections here only switch the rail; configuring credentials stays in
// the provider settings surface.
const HUB_PROVIDERS: HubProviderItem[] = [
  { id: 'openrouter', name: 'OpenRouter', desc: '聚合 40+ 家服务商的统一 API', category: '聚合' },
  { id: 'fireworks', name: 'Fireworks AI', desc: '面向开源模型的高速推理平台', category: '高速推理' },
  { id: 'groq', name: 'Groq', desc: 'LPU 推理引擎，实时级响应速度', category: 'LPU' },
  { id: 'cerebras', name: 'Cerebras', desc: '晶圆级 AI 加速引擎', category: '硬件' },
  { id: 'replicate', name: 'Replicate', desc: '云端运行开源模型的 API 平台', category: '云端 API' },
  { id: 'deepinfra', name: 'DeepInfra', desc: '低成本的按需推理服务', category: 'Serverless' },
  { id: 'together', name: 'Together AI', desc: '开源模型托管与微调', category: '云端托管' },
  { id: 'cohere', name: 'Cohere', desc: '面向企业的检索、重排与 Command R+', category: '企业级' },
  { id: 'mistral', name: 'Mistral AI', desc: 'Mistral Large 与 Pixtral 系列', category: '基础模型' },
  { id: 'anthropic', name: 'Anthropic', desc: 'Claude 系列与混合推理', category: '基础模型' },
  { id: 'openai', name: 'OpenAI', desc: 'GPT 与 o 系列推理模型', category: '基础模型' },
  { id: 'deepseek', name: 'DeepSeek', desc: 'DeepSeek-R1 与 DeepSeek-V3', category: '基础模型' },
  { id: 'google', name: 'Google Gemini', desc: 'Gemini 2.5 Pro 与 Flash 多模态模型', category: '基础模型' },
]

const PROVIDER_SEARCH_DEBOUNCE_MS = 150

// Matches the rendered height of `.composer-effort-dropdown`, used only to
// decide whether the menu has room to open downward inside the scroll list.
const EFFORT_MENU_HEIGHT = 122
const EFFORT_MENU_GAP = 16

export function ModelPickerPopover({
  open,
  onOpenChange,
  trigger,
  selectedProviderID,
  selectedModelPreset,
  providerOptions,
  deepSeekThinkingControls,
  showThinkingOptions,
  thinkingMode,
  thinkingPreviewMode,
  thinkingOptions,
  onThinkingChange,
  onThinkingPreviewChange,
  onProviderModelChange,
  onProviderOpen,
  onProviderSearch,
  onOpenModelSettings,
  align = 'end',
  side = 'top',
  sideOffset = 4,
}: ModelPickerPopoverProps): React.ReactNode {
  const [activeProviderID, setActiveProviderID] = useState<ModelProviderID>(
    selectedProviderID ?? providerOptions[0]?.providerID ?? 'openai',
  )
  const [isHubOpen, setIsHubOpen] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [hubFilterText, setHubFilterText] = useState('')
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const [effortDropUp, setEffortDropUp] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const effortAnchorRef = useRef<HTMLDivElement>(null)
  const modelsListRef = useRef<HTMLDivElement>(null)
  const providerSearchTimersRef = useRef(
    new Map<ModelProviderID, ReturnType<typeof setTimeout>>(),
  )
  const lastForwardedQueryRef = useRef('')

  const effectiveThinkingOptions = useMemo(
    () => resolveThinkingOptions(deepSeekThinkingControls, thinkingOptions),
    [deepSeekThinkingControls, thinkingOptions],
  )
  const currentThinkingLabel = resolveThinkingLabel(
    effectiveThinkingOptions,
    thinkingPreviewMode ?? thinkingMode,
  )

  useEffect(() => {
    if (selectedProviderID) setActiveProviderID(selectedProviderID)
  }, [selectedProviderID])

  useEffect(() => {
    if (open && activeProviderID) onProviderOpen?.(activeProviderID)
    if (!open) {
      // A closing panel must not leave the provider catalogue narrowed to the
      // last query, because the next open reuses that catalogue.
      if (lastForwardedQueryRef.current) {
        lastForwardedQueryRef.current = ''
        onProviderSearch?.(activeProviderID, '')
      }
      setIsHubOpen(false)
      setSearchExpanded(false)
      setFilterText('')
      setHubFilterText('')
      setEffortMenuOpen(false)
    }
  }, [open, activeProviderID, onProviderOpen, onProviderSearch])

  useEffect(() => {
    if (searchExpanded) searchInputRef.current?.focus()
  }, [searchExpanded])

  useEffect(
    () => () => {
      for (const timer of providerSearchTimersRef.current.values()) clearTimeout(timer)
      providerSearchTimersRef.current.clear()
    },
    [],
  )

  // The effort menu is anchored to its pill inside the selected row, so it
  // needs its own dismissal path; the panel's Radix dismissal only covers the
  // popover itself.
  useEffect(() => {
    if (!effortMenuOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (effortAnchorRef.current?.contains(event.target as Node)) return
      setEffortMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setEffortMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [effortMenuOpen])

  const currentProvider = useMemo(
    () =>
      providerOptions.find(provider => provider.providerID === activeProviderID) ??
      providerOptions[0] ?? {
        providerID: activeProviderID,
        displayName: activeProviderID,
        modelPresets: [],
      },
    [activeProviderID, providerOptions],
  )

  const filteredModels = useMemo(() => {
    const query = filterText.trim().toLowerCase()
    if (!query) return currentProvider.modelPresets
    return currentProvider.modelPresets.filter(
      model =>
        model.label.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query),
    )
  }, [currentProvider, filterText])

  const filteredHubProviders = useMemo(() => {
    const query = hubFilterText.trim().toLowerCase()
    if (!query) return HUB_PROVIDERS
    return HUB_PROVIDERS.filter(
      provider =>
        provider.name.toLowerCase().includes(query) ||
        provider.desc.toLowerCase().includes(query) ||
        provider.category.toLowerCase().includes(query),
    )
  }, [hubFilterText])

  // Large provider catalogues are paged on the agent side, so a paused query is
  // forwarded to the provider controller in addition to the local filter.
  const queueProviderSearch = useCallback(
    (providerID: ModelProviderID, query: string): void => {
      if (!onProviderSearch) return
      const pending = providerSearchTimersRef.current.get(providerID)
      if (pending) clearTimeout(pending)
      providerSearchTimersRef.current.set(
        providerID,
        setTimeout(() => {
          providerSearchTimersRef.current.delete(providerID)
          lastForwardedQueryRef.current = query.trim()
          onProviderSearch(providerID, query.trim())
        }, PROVIDER_SEARCH_DEBOUNCE_MS),
      )
    },
    [onProviderSearch],
  )

  const handleProviderSelect = useCallback(
    (providerID: ModelProviderID) => {
      setIsHubOpen(false)
      setActiveProviderID(providerID)
      setEffortMenuOpen(false)
      onProviderOpen?.(providerID)
    },
    [onProviderOpen],
  )

  const handleModelSelect = (modelID: string): void => {
    onProviderModelChange(activeProviderID, modelID)
    onOpenChange(false)
  }

  const handleFilterChange = (value: string): void => {
    setFilterText(value)
    queueProviderSearch(activeProviderID, value)
  }

  // Clearing the query also resets the provider catalogue the query narrowed,
  // otherwise the visible list stays limited to the last search result.
  const resetFilter = (): void => {
    setFilterText('')
    setSearchExpanded(false)
    queueProviderSearch(activeProviderID, '')
  }

  const toggleEffortMenu = (): void => {
    if (effortMenuOpen) {
      setEffortMenuOpen(false)
      return
    }
    const anchor = effortAnchorRef.current
    const list = modelsListRef.current
    if (anchor && list) {
      setEffortDropUp(
        anchor.getBoundingClientRect().bottom + EFFORT_MENU_HEIGHT + EFFORT_MENU_GAP >
          list.getBoundingClientRect().bottom,
      )
    }
    setEffortMenuOpen(true)
  }

  // A provider without a configured catalogue entry is a models.dev provider,
  // so its logo still comes from the same catalogue URL contract.
  const providerLogoURL = (targetProviderID: string): string =>
    providerOptions.find(option => option.providerID === targetProviderID)?.logoURL ??
    modelsDevLogoURL(targetProviderID)

  const handleHubSelect = (hubProviderID: string): void => {
    const configured = providerOptions.find(
      provider => provider.providerID === hubProviderID,
    )
    if (configured) {
      handleProviderSelect(configured.providerID)
      return
    }
    // Unconfigured providers have no catalogue to browse, so send the user to
    // the surface that can actually add credentials.
    if (onOpenModelSettings) {
      onOpenChange(false)
      onOpenModelSettings()
      return
    }
    handleProviderSelect(hubProviderID as ModelProviderID)
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className="composer-model-panel-content"
        >
          <div className="composer-model-panel">
            {/* Left provider rail */}
            <div className="composer-provider-rail">
              <div className="composer-provider-list">
                {providerOptions.length > 0 ? (
                  providerOptions.map(provider => {
                    const isActive =
                      !isHubOpen && provider.providerID === activeProviderID
                    return (
                      <button
                        key={provider.providerID}
                        type="button"
                        onClick={() => handleProviderSelect(provider.providerID)}
                        className={`composer-provider-btn${
                          isActive ? ' is-active' : ''
                        }`}
                        title={provider.displayName || provider.providerID}
                      >
                        <ProviderLogo logoURL={provider.logoURL} />
                      </button>
                    )
                  })
                ) : (
                  <button
                    type="button"
                    className="composer-provider-btn is-active"
                    title={activeProviderID}
                  >
                    <ProviderLogo logoURL={providerLogoURL(activeProviderID)} />
                  </button>
                )}
              </div>

              <div className="composer-hub-trigger-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setIsHubOpen(previous => !previous)
                    setEffortMenuOpen(false)
                  }}
                  className={`composer-hub-trigger-btn${isHubOpen ? ' is-active' : ''}`}
                  title="模型中心：发现并配置服务商"
                >
                  <Plus size={18} strokeWidth={2.2} />
                </button>
              </div>
            </div>

            <div className="composer-model-right">
              {isHubOpen ? (
                <div className="composer-picker-view">
                  <div className="composer-models-header">
                    <div className="composer-models-header-lead">
                      <button
                        type="button"
                        onClick={() => setIsHubOpen(false)}
                        className="composer-hub-back"
                        title="返回模型列表"
                      >
                        <ChevronLeft size={16} strokeWidth={2.2} />
                      </button>
                      <span className="composer-models-title">模型中心</span>
                    </div>

                    <div className="composer-search-bar">
                      <Search
                        size={14}
                        strokeWidth={2}
                        className="composer-search-bar-icon"
                      />
                      <input
                        type="text"
                        placeholder="搜索服务商..."
                        value={hubFilterText}
                        onChange={event => setHubFilterText(event.target.value)}
                        className="composer-search-input"
                      />
                    </div>
                  </div>

                  <div className="composer-models-list">
                    {filteredHubProviders.length > 0 ? (
                      filteredHubProviders.map(provider => {
                        const isConfigured = providerOptions.some(
                          option => option.providerID === provider.id,
                        )
                        return (
                          <div key={provider.id} className="composer-hub-row">
                            <div className="composer-hub-row-main">
                              <div className="composer-hub-row-logo">
                                <ProviderLogo logoURL={providerLogoURL(provider.id)} />
                              </div>
                              <div className="composer-hub-row-text">
                                <div className="composer-hub-row-title">
                                  <span className="composer-hub-row-name">
                                    {provider.name}
                                  </span>
                                  <span className="composer-hub-badge">
                                    {provider.category}
                                  </span>
                                </div>
                                <p className="composer-hub-row-desc">
                                  {provider.desc}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleHubSelect(provider.id)}
                              className={`composer-hub-action-btn${
                                isConfigured ? ' is-configured' : ''
                              }`}
                            >
                              {isConfigured ? '已配置' : '去配置'}
                            </button>
                          </div>
                        )
                      })
                    ) : (
                      <div className="composer-models-empty">
                        没有匹配的服务商
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="composer-picker-view">
                  <div className="composer-models-header">
                    <span className="composer-models-title">
                      {currentProvider.displayName || '模型列表'}
                    </span>

                    <div className="composer-models-header-actions">
                      {searchExpanded ? (
                        <div className="composer-search-bar">
                          <Search
                            size={14}
                            strokeWidth={2}
                            className="composer-search-bar-icon"
                          />
                          <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="过滤模型..."
                            value={filterText}
                            onChange={event => handleFilterChange(event.target.value)}
                            onKeyDown={event => {
                              if (event.key !== 'Escape') return
                              event.stopPropagation()
                              resetFilter()
                            }}
                            className="composer-search-input"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              resetFilter()
                              searchInputRef.current?.blur()
                            }}
                            className="composer-search-clear"
                            title="清除并关闭"
                          >
                            <X size={12} strokeWidth={2.5} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSearchExpanded(true)}
                          className="composer-search-trigger"
                        >
                          <span>快速搜索</span>
                          <Search size={14} strokeWidth={2.2} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div ref={modelsListRef} className="composer-models-list">
                    {filteredModels.length > 0 ? (
                      filteredModels.map(preset => {
                        const isSelected = preset.id === selectedModelPreset
                        return (
                          <div
                            key={preset.id}
                            onClick={() => handleModelSelect(preset.id)}
                            className={`composer-model-row${
                              isSelected ? ' is-selected' : ''
                            }`}
                          >
                            <div className="composer-model-row-main">
                              <span className="composer-model-name">
                                {preset.label || preset.id}
                              </span>
                            </div>

                            <div className="composer-model-row-trailing">
                              {isSelected && showThinkingOptions ? (
                                <div
                                  ref={effortAnchorRef}
                                  className="composer-effort-anchor"
                                >
                                  <button
                                    type="button"
                                    aria-expanded={effortMenuOpen}
                                    onClick={event => {
                                      event.stopPropagation()
                                      toggleEffortMenu()
                                    }}
                                    className="composer-effort-pill"
                                    title="推理思考强度"
                                  >
                                    <span>{currentThinkingLabel}</span>
                                    <ChevronDown size={12} strokeWidth={2.5} />
                                  </button>

                                  {effortMenuOpen ? (
                                    <div
                                      onClick={event => event.stopPropagation()}
                                      className={`composer-effort-dropdown${
                                        effortDropUp ? ' is-above' : ''
                                      }`}
                                    >
                                      <div className="composer-effort-dropdown-title">
                                        推理思考
                                      </div>
                                      {effectiveThinkingOptions.map(option => {
                                        const isCurrent =
                                          option.value === thinkingMode
                                        return (
                                          <div
                                            key={option.value}
                                            onClick={() => {
                                              onThinkingChange(option.value)
                                              setEffortMenuOpen(false)
                                            }}
                                            onPointerEnter={() =>
                                              onThinkingPreviewChange?.(option.value)
                                            }
                                            onPointerLeave={() =>
                                              onThinkingPreviewChange?.(null)
                                            }
                                            className="composer-effort-item"
                                          >
                                            <span>{option.label}</span>
                                            {isCurrent ? (
                                              <Check
                                                size={14}
                                                strokeWidth={2.4}
                                                className="composer-effort-check"
                                              />
                                            ) : null}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              <span
                                aria-hidden="true"
                                className={`composer-model-dot${
                                  isSelected ? ' is-selected' : ''
                                }`}
                              />
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="composer-models-empty">
                        {filterText ? '没有匹配的模型' : '暂无可用的预设模型'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
