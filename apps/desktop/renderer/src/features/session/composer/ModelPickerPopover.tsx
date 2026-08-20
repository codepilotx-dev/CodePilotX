import React, { useMemo, useRef, useState, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check } from 'lucide-react'
import type { DesktopThinkingMode, ModelProviderID } from '../../../../shared/types.js'
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
  showThinkingOptions: boolean
  deepSeekThinkingControls: boolean
  thinkingMode: DesktopThinkingMode
  thinkingOptions: Array<{ value: DesktopThinkingMode; label: string }>
  onThinkingChange: (mode: DesktopThinkingMode) => void
  onProviderModelChange: (providerID: ModelProviderID, modelID: string) => void
  onProviderOpen?: (providerID: ModelProviderID) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

type ThickPillSliderProps = {
  options: Array<{ value: DesktopThinkingMode; label: string }>
  value: DesktopThinkingMode
  onChange: (value: DesktopThinkingMode) => void
}

/**
 * 具有物理阻尼感（Damped Spring）与零闪烁 Pointer Capture 的厚胶囊离散滑块
 */
function ThickPillSlider({
  options,
  value,
  onChange,
}: ThickPillSliderProps): React.ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragProgress, setDragProgress] = useState<number | null>(null)

  const currentIndex = Math.max(
    0,
    options.findIndex(opt => opt.value === value),
  )
  const totalSteps = options.length
  const stepCount = Math.max(1, totalSteps - 1)

  const activeRatio =
    dragProgress !== null ? dragProgress : totalSteps > 1 ? currentIndex / stepCount : 0

  const activeIndex = Math.round(activeRatio * stepCount)
  const isMax = activeIndex === stepCount && totalSteps > 1

  const computeRatio = (clientX: number): number => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const trackPadding = 12
    const usableWidth = Math.max(1, rect.width - trackPadding * 2)
    const offsetX = clientX - rect.left - trackPadding
    return Math.max(0, Math.min(1, offsetX / usableWidth))
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    trackRef.current?.setPointerCapture(e.pointerId)
    setIsDragging(true)
    const ratio = computeRatio(e.clientX)
    setDragProgress(ratio)
    const targetIdx = Math.round(ratio * stepCount)
    if (options[targetIdx] && options[targetIdx].value !== value) {
      onChange(options[targetIdx].value)
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const ratio = computeRatio(e.clientX)
    setDragProgress(ratio)
    const targetIdx = Math.round(ratio * stepCount)
    if (options[targetIdx] && options[targetIdx].value !== value) {
      onChange(options[targetIdx].value)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    try {
      trackRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    const ratio = computeRatio(e.clientX)
    const targetIdx = Math.round(ratio * stepCount)
    setIsDragging(false)
    setDragProgress(null)
    if (options[targetIdx]) {
      onChange(options[targetIdx].value)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      const nextIdx = Math.min(stepCount, currentIndex + 1)
      if (options[nextIdx]) onChange(options[nextIdx].value)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIdx = Math.max(0, currentIndex - 1)
      if (options[nextIdx]) onChange(options[nextIdx].value)
    } else if (e.key === 'Home') {
      e.preventDefault()
      if (options[0]) onChange(options[0].value)
    } else if (e.key === 'End') {
      e.preventDefault()
      if (options[stepCount]) onChange(options[stepCount].value)
    }
  }

  return (
    <div className="rm-picker-thick-slider-container">
      <div
        ref={trackRef}
        aria-label="调节推理强度"
        aria-valuemax={stepCount}
        aria-valuemin={0}
        aria-valuenow={activeIndex}
        aria-valuetext={options[activeIndex]?.label}
        className={cx('rm-thick-slider-track', isDragging && 'is-dragging')}
        role="slider"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Background range fill */}
        <div
          className={cx(
            'rm-thick-slider-range',
            isDragging && 'is-dragging',
            activeIndex === 0 && options[0]?.value === 'disabled' && 'is-disabled-level',
          )}
          style={{
            width: `calc(20px + (100% - 24px) * ${activeRatio})`,
          }}
        />

        {/* Tick Dots */}
        {options.map((opt, index) => {
          const dotRatio = stepCount > 0 ? index / stepCount : 0
          const isPassed = index <= activeIndex
          const isCurrent = index === activeIndex
          return (
            <span
              key={opt.value}
              className={cx(
                'rm-thick-slider-dot',
                isPassed && 'is-passed',
                isCurrent && 'is-current',
              )}
              style={{
                left: `calc(12px + (100% - 24px) * ${dotRatio})`,
              }}
            />
          )
        })}

        {/* Thumb */}
        <div
          className={cx('rm-thick-slider-thumb', isDragging && 'is-dragging')}
          style={{
            left: `calc(2px + (100% - 24px) * ${activeRatio})`,
          }}
        />
      </div>

      <div className="rm-thick-slider-footer">
        <span
          className="rm-thick-slider-footer-left"
          role="button"
          tabIndex={0}
          onClick={() => {
            if (options[0]) onChange(options[0].value)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (options[0]) onChange(options[0].value)
            }
          }}
        >
          更快
        </span>
        <span
          className="rm-thick-slider-footer-right"
          role="button"
          tabIndex={0}
          onClick={() => {
            if (options[stepCount]) onChange(options[stepCount].value)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (options[stepCount]) onChange(options[stepCount].value)
            }
          }}
        >
          更智能
        </span>
      </div>
    </div>
  )
}

export function ModelPickerPopover({
  open,
  onOpenChange,
  trigger,
  selectedProviderID,
  selectedModelPreset,
  providerOptions,
  showThinkingOptions,
  deepSeekThinkingControls,
  thinkingMode,
  thinkingOptions,
  onThinkingChange,
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

  const effectiveThinkingOptions = useMemo(() => {
    if (deepSeekThinkingControls) {
      return [
        { value: 'disabled' as DesktopThinkingMode, label: '关闭' },
        { value: 'default' as DesktopThinkingMode, label: '高' },
        { value: 'enabled' as DesktopThinkingMode, label: '超高' },
      ]
    }
    return thinkingOptions
  }, [deepSeekThinkingControls, thinkingOptions])

  const currentThinkingIndex = Math.max(
    0,
    effectiveThinkingOptions.findIndex(opt => opt.value === thinkingMode),
  )

  const currentThinkingLabel =
    effectiveThinkingOptions[currentThinkingIndex]?.label ?? '默认'

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
          aria-label="模型与推理设置"
          className="popover-surface rm-model-picker-panel tw:text-app-text"
          collisionPadding={8}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ width: 440 })}
          onOpenAutoFocus={event => {
            event.preventDefault()
          }}
        >
          {/* 顶部：带真实物理阻尼感与平滑吸附的厚胶囊滑块 */}
          {showThinkingOptions ? (
            <div className="rm-model-picker-header">
              <div className="rm-picker-thinking-section">
                <div className="rm-picker-section-title-row">
                  <span className="rm-picker-section-title">推理强度</span>
                  <span className="rm-picker-section-value">{currentThinkingLabel}</span>
                </div>
                <ThickPillSlider
                  options={effectiveThinkingOptions}
                  value={thinkingMode}
                  onChange={onThinkingChange}
                />
              </div>
            </div>
          ) : null}

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
