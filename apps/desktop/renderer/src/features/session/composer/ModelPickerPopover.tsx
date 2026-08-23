import React, { useMemo, useRef, useState, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check } from 'lucide-react'
import type { ModelProviderID } from '../../../../shared/types.js'
import type { ModelPreset } from '../../../modelPresets.js'
import { getModelDescription } from '../../../modelPresets.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { buildPopoverSizingStyle } from '../../../components/ui/popoverSizing.js'
import { cx } from '../../../utils/cx.js'

export type ProviderModelOption = {
  providerID: ModelProviderID
  displayName: string
  modelPresets: ModelPreset[]
}

export type ModelPickerPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactElement
  selectedProviderID?: ModelProviderID
  selectedModelPreset?: string
  providerOptions: ProviderModelOption[]
  onProviderModelChange: (providerID: ModelProviderID, modelID: string) => void
  onProviderOpen?: (providerID: ModelProviderID) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

export function ModelPickerPopover({
  open,
  onOpenChange,
  trigger,
  selectedProviderID,
  selectedModelPreset,
  providerOptions,
  onProviderModelChange,
  onProviderOpen,
  align = 'end',
  side = 'top',
  sideOffset = 6,
}: ModelPickerPopoverProps): React.ReactNode {
  const [activeProviderID, setActiveProviderID] = useState<ModelProviderID | undefined>(
    selectedProviderID ?? providerOptions[0]?.providerID,
  )
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const prevOpenRef = useRef(open)

  // 仅在弹窗打开的一瞬间同步 activeProviderID 并预加载，避免拖拽推理滑块时重复触发
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const targetProviderID = selectedProviderID ?? providerOptions[0]?.providerID
      if (targetProviderID) setActiveProviderID(targetProviderID)
      for (const provider of providerOptions) {
        onProviderOpen?.(provider.providerID)
      }
    }
    if (!open) {
      setSearchQuery('')
    }
    prevOpenRef.current = open
  }, [open, selectedProviderID, providerOptions, onProviderOpen])

  const activeProvider = useMemo(() => {
    return (
      providerOptions.find(provider => provider.providerID === activeProviderID) ??
      providerOptions[0]
    )
  }, [providerOptions, activeProviderID])

  const trimmedQuery = searchQuery.trim().toLowerCase()

  // 跨所有提供商搜索模型
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return []
    const results: Array<{
      provider: ProviderModelOption
      preset: ModelPreset
    }> = []

    for (const provider of providerOptions) {
      for (const preset of provider.modelPresets) {
        const matchesLabel = preset.label.toLowerCase().includes(trimmedQuery)
        const matchesId = preset.id.toLowerCase().includes(trimmedQuery)
        const matchesProvider = provider.displayName.toLowerCase().includes(trimmedQuery)
        if (matchesLabel || matchesId || matchesProvider) {
          results.push({ provider, preset })
        }
      }
    }
    return results
  }, [providerOptions, trimmedQuery])

  const handleProviderSelect = (providerID: ModelProviderID): void => {
    setActiveProviderID(providerID)
    onProviderOpen?.(providerID)
  }

  const handleModelSelect = (providerID: ModelProviderID, modelID: string): void => {
    onProviderModelChange(providerID, modelID)
    onOpenChange(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          aria-label="选择模型"
          className="popover-surface rm-model-picker-panel tw:text-app-text"
          collisionPadding={8}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ width: 440 })}
          onOpenAutoFocus={event => {
            event.preventDefault()
          }}
        >
          {/* 搜索框 */}
          <div className="rm-model-picker-search">
            <SearchInput
              ref={searchInputRef}
              aria-label="搜索模型"
              placeholder="搜索模型（支持跨提供商）…"
              value={searchQuery}
              variant="compact"
              onChange={setSearchQuery}
            />
          </div>

          {/* 主体区域 */}
          {trimmedQuery ? (
            /* 搜索模式：平铺展示跨提供商匹配结果 */
            <div className="rm-model-picker-search-results" role="listbox">
              {searchResults.length === 0 ? (
                <div className="rm-picker-empty">未找到匹配 “{searchQuery}” 的模型</div>
              ) : (
                searchResults.map(({ provider, preset }) => {
                  const isSelected =
                    provider.providerID === selectedProviderID &&
                    preset.id === selectedModelPreset
                  return (
                    <button
                      key={`${provider.providerID}:${preset.id}`}
                      aria-selected={isSelected}
                      className={cx(
                        'rm-picker-model-item',
                        'search-result-item',
                        isSelected && 'is-selected',
                      )}
                      role="option"
                      type="button"
                      onClick={() => handleModelSelect(provider.providerID, preset.id)}
                    >
                      <div className="rm-model-item-info">
                        <span className="rm-model-item-name">{preset.label}</span>
                        <span className="rm-model-item-badge">{provider.displayName}</span>
                      </div>
                      {isSelected ? (
                        <Check
                          className="rm-model-item-check"
                          size={APP_ICON_SIZE}
                          strokeWidth={APP_ICON_STROKE_WIDTH}
                        />
                      ) : null}
                    </button>
                  )
                })
              )}
            </div>
          ) : (
            /* 默认模式：左右两栏 Master-Detail 布局 */
            <div className="rm-model-picker-body">
              {/* 左栏：提供商导航 */}
              <div
                aria-label="模型提供商"
                className="rm-model-picker-providers"
                role="tablist"
              >
                {providerOptions.map(provider => {
                  const isActive = provider.providerID === activeProvider?.providerID
                  const isSelected = provider.providerID === selectedProviderID
                  return (
                    <button
                      key={provider.providerID}
                      aria-selected={isActive}
                      className={cx(
                        'rm-picker-provider-item',
                        isActive && 'is-active',
                        isSelected && 'is-selected',
                      )}
                      role="tab"
                      tabIndex={isActive ? 0 : -1}
                      type="button"
                      onClick={() => handleProviderSelect(provider.providerID)}
                      onMouseEnter={() => handleProviderSelect(provider.providerID)}
                    >
                      <span className="rm-provider-item-name">{provider.displayName}</span>
                      {isSelected ? (
                        <span
                          className="rm-provider-selected-dot"
                          title="当前选中的提供商"
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {/* 右栏：模型列表 */}
              <div
                aria-label={`${activeProvider?.displayName ?? ''} 模型列表`}
                className="rm-model-picker-models"
                role="listbox"
              >
                {activeProvider && activeProvider.modelPresets.length > 0 ? (
                  activeProvider.modelPresets.map(preset => {
                    const isSelected =
                      activeProvider.providerID === selectedProviderID &&
                      preset.id === selectedModelPreset
                    const description = getModelDescription(preset.id)
                    return (
                      <button
                        key={preset.id}
                        aria-selected={isSelected}
                        className={cx(
                          'rm-picker-model-item',
                          isSelected && 'is-selected',
                        )}
                        role="option"
                        type="button"
                        onClick={() => handleModelSelect(activeProvider.providerID, preset.id)}
                      >
                        <div className="rm-model-item-info">
                          <span className="rm-model-item-name">{preset.label}</span>
                          {description ? (
                            <span className="rm-model-item-desc">{description}</span>
                          ) : null}
                        </div>
                        {isSelected ? (
                          <Check
                            className="rm-model-item-check"
                            size={APP_ICON_SIZE}
                            strokeWidth={APP_ICON_STROKE_WIDTH}
                          />
                        ) : null}
                      </button>
                    )
                  })
                ) : (
                  <div className="rm-picker-empty">加载模型中…</div>
                )}
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
