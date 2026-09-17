import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import {
  ChevronDown,
  ChevronLeft,
  Plus,
  Search,
  X,
} from 'lucide-react'
import type { DesktopModelProviderSummary, ModelProviderID } from '../../../../shared/types.js'
import type { ModelPreset } from '../../../modelPresets.js'
import {
  resolveThinkingLabel,
  resolveThinkingOptions,
  type ThinkingOption,
} from './ThinkingLevelPopover.js'
import { ProviderLogo } from './providerLogos.js'
import { ReasoningMenu } from './ReasoningMenu.js'

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
  allProviders?: readonly DesktopModelProviderSummary[]
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
  logoURL?: string
}

const PROVIDER_SEARCH_DEBOUNCE_MS = 150

export function ModelPickerPopover({
  open,
  onOpenChange,
  trigger,
  selectedProviderID,
  selectedModelPreset,
  providerOptions,
  allProviders,
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
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hubSearchInputRef = useRef<HTMLInputElement>(null)
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

  const hubProviders = useMemo<HubProviderItem[]>(() => {
    if (allProviders && allProviders.length > 0) {
      return allProviders.map(p => {
        const isCustom = p.providerKind === 'custom'
        const count = p.modelCount ?? p.defaultModels.length
        return {
          id: p.providerID,
          name: p.displayName || p.providerID,
          desc: isCustom
            ? '自定义 Provider · Pi 执行'
            : count > 0
              ? `${count} 个可用模型`
              : 'Pi 内置提供商',
          category: isCustom ? '自定义' : 'Pi 内置',
          logoURL: p.logoURL,
        }
      })
    }
    return providerOptions.map(option => ({
      id: option.providerID,
      name: option.displayName || option.providerID,
      desc:
        option.modelPresets.length > 0
          ? `${option.modelPresets.length} 个可用模型`
          : 'Pi 内置提供商',
      category: 'Pi 内置',
      logoURL: option.logoURL,
    }))
  }, [allProviders, providerOptions])

  const filteredHubProviders = useMemo(() => {
    const query = hubFilterText.trim().toLowerCase()
    if (!query) return hubProviders
    return hubProviders.filter(
      provider =>
        provider.name.toLowerCase().includes(query) ||
        provider.desc.toLowerCase().includes(query) ||
        provider.category.toLowerCase().includes(query),
    )
  }, [hubFilterText, hubProviders])

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

  const providerLogoURL = (targetProviderID: string): string | undefined => {
    const option = providerOptions.find(opt => opt.providerID === targetProviderID)
    if (option?.logoURL) return option.logoURL
    const hub = hubProviders.find(item => item.id === targetProviderID)
    return hub?.logoURL
  }

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
                  onClick={() => setIsHubOpen(previous => !previous)}
                  className={`composer-hub-trigger-btn${isHubOpen ? ' is-active' : ''}`}
                  title="模型中心：发现并配置服务商"
                >
                  <Plus size={18} strokeWidth={2.2} />
                </button>
              </div>
            </div>

            {/* Right panel */}
            <div className="composer-model-right">
              {isHubOpen ? (
                /* View 2: Model Hub view */
                <div className="composer-picker-view animate-dropdown">
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

                    <div className="composer-hub-search-bar">
                      <Search
                        size={14}
                        strokeWidth={2}
                        className="composer-search-bar-icon"
                      />
                      <input
                        ref={hubSearchInputRef}
                        type="text"
                        placeholder="搜索服务商..."
                        value={hubFilterText}
                        onChange={event => setHubFilterText(event.target.value)}
                        className="composer-hub-search-input"
                      />
                    </div>
                  </div>

                  <div className="composer-models-list composer-hub-list">
                    {filteredHubProviders.length > 0 ? (
                      filteredHubProviders.map(provider => {
                        const isConfigured = providerOptions.some(
                          option => option.providerID === provider.id,
                        )
                        return (
                          <div
                            key={provider.id}
                            className="composer-hub-row"
                            onClick={() => {
                              if (isConfigured) handleHubSelect(provider.id)
                            }}
                          >
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
                            <div className="composer-hub-row-actions">
                              {isConfigured ? (
                                <span className="composer-hub-badge-connected">
                                  已配置
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={event => {
                                    event.stopPropagation()
                                    handleHubSelect(provider.id)
                                  }}
                                  className="composer-hub-action-btn"
                                >
                                  去配置
                                </button>
                              )}
                            </div>
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
                /* View 1: Models Selection View */
                <div className="composer-picker-view">
                  <div className="composer-models-header">
                    <span className="composer-models-title">
                      {currentProvider.displayName || '模型列表'}
                    </span>

                    <div className="composer-models-header-actions">
                      {searchExpanded ? (
                        <div className="composer-search-bar animate-search-in">
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

                  <div className="composer-models-list">
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
                              <span
                                className={`composer-model-row-icon${
                                  isSelected ? ' is-active' : ''
                                }`}
                              >
                                <ProviderLogo
                                  logoURL={currentProvider.logoURL}
                                />
                              </span>
                              <span className="composer-model-name">
                                {preset.label || preset.id}
                              </span>
                            </div>

                            <div className="composer-model-row-trailing">
                              {isSelected && showThinkingOptions ? (
                                <ReasoningMenu
                                  thinkingMode={thinkingMode}
                                  thinkingPreviewMode={thinkingPreviewMode}
                                  thinkingOptions={effectiveThinkingOptions}
                                  onThinkingChange={onThinkingChange}
                                  onThinkingPreviewChange={onThinkingPreviewChange}
                                  side="top"
                                  sideOffset={6}
                                  align="end"
                                  trigger={
                                    <button
                                      type="button"
                                      onClick={event => event.stopPropagation()}
                                      className="composer-effort-pill"
                                      title="选择推理思考强度"
                                      aria-label={`推理思考强度：${currentThinkingLabel}`}
                                    >
                                      <span>{currentThinkingLabel}</span>
                                      <ChevronDown size={12} strokeWidth={2.5} />
                                    </button>
                                  }
                                />
                              ) : null}

                              <div
                                aria-hidden="true"
                                className={`composer-model-dot${
                                  isSelected ? ' is-selected' : ''
                                }`}
                              >
                                {isSelected ? (
                                  <div className="composer-model-dot-inner" />
                                ) : null}
                              </div>
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
