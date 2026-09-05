import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'lucide-react'
import type {
  DesktopThinkingMode,
  ModelProviderID,
} from '../../../../shared/types.js'
import type { ModelPreset } from '../../../modelPresets.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { buildPopoverSizingStyle } from '../../../components/ui/popoverSizing.js'
import {
  resolveThinkingLabel,
  resolveThinkingOptions,
  ThinkingLevelControl,
  type ThinkingOption,
} from './ThinkingLevelPopover.js'

export type ProviderModelOption = {
  providerID: ModelProviderID
  displayName: string
  modelPresets: ModelPreset[]
}

type IntelligencePickerView = 'simple' | 'advanced'

export type ModelPickerPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactElement
  selectedProviderID?: ModelProviderID
  selectedModelPreset?: string
  providerOptions: ProviderModelOption[]
  deepSeekThinkingControls: boolean
  showThinkingOptions: boolean
  thinkingMode: DesktopThinkingMode
  thinkingPreviewMode?: DesktopThinkingMode | null
  thinkingOptions: ThinkingOption[]
  onThinkingChange: (mode: DesktopThinkingMode) => void
  onThinkingPreviewChange?: (mode: DesktopThinkingMode | null) => void
  onProviderModelChange: (providerID: ModelProviderID, modelID: string) => void
  onProviderOpen?: (providerID: ModelProviderID) => void
  onProviderSearch?: (providerID: ModelProviderID, query: string) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

type IntelligenceSubmenuTriggerProps = {
  label: string
  value: string
  disabled?: boolean
  onFocus?: () => void
  onPointerEnter?: () => void
}

const IntelligenceSubmenuTrigger = React.forwardRef<
  HTMLDivElement,
  IntelligenceSubmenuTriggerProps
>(function IntelligenceSubmenuTrigger(
  { label, value, disabled, onFocus, onPointerEnter },
  ref,
): React.ReactNode {
  return (
    <DropdownMenu.SubTrigger
      ref={ref}
      aria-label={`${label}：${value}`}
      className="popover-item popover-sub-trigger rm-intelligence-row"
      disabled={disabled}
      onFocus={onFocus}
      onPointerEnter={onPointerEnter}
    >
      <span className="rm-intelligence-row-label">{label}</span>
      <span className="rm-intelligence-row-value">{value}</span>
      <ChevronRight
        aria-hidden="true"
        className="popover-item-arrow rm-intelligence-row-arrow"
        size={APP_ICON_SIZE}
        strokeWidth={APP_ICON_STROKE_WIDTH}
      />
    </DropdownMenu.SubTrigger>
  )
})

type IntelligenceSubmenuContentProps = {
  children: React.ReactNode
  contentLabel: string
  className?: string
  onEscapeKeyDown?: React.ComponentPropsWithoutRef<
    typeof DropdownMenu.SubContent
  >['onEscapeKeyDown']
  width: number
}

function IntelligenceSubmenuContent({
  children,
  contentLabel,
  className = '',
  onEscapeKeyDown,
  width,
}: IntelligenceSubmenuContentProps): React.ReactNode {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        alignOffset={-4}
        aria-label={contentLabel}
        className={`popover-surface popover popover-sub-content rm-intelligence-submenu ${className}`}
        collisionPadding={6}
        data-theme-component="dropdown-surface"
        onEscapeKeyDown={onEscapeKeyDown}
        sideOffset={4}
        style={buildPopoverSizingStyle({
          width,
          maxWidth: 'calc(100vw - 16px)',
        })}
      >
        {children}
      </DropdownMenu.SubContent>
    </DropdownMenu.Portal>
  )
}

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
  align = 'end',
  side = 'top',
  sideOffset = 6,
}: ModelPickerPopoverProps): React.ReactNode {
  const [pickerView, setPickerView] = useState<IntelligencePickerView>('simple')
  const [modelSubmenuOpen, setModelSubmenuOpen] = useState(false)
  const [thinkingSubmenuOpen, setThinkingSubmenuOpen] = useState(false)
  const [providerSubmenuOpen, setProviderSubmenuOpen] = useState(false)
  const [endpointLabelsVisible, setEndpointLabelsVisible] = useState(false)
  const [providerSearchQueries, setProviderSearchQueries] = useState<
    Record<string, string>
  >({})
  const [activeModelIndex, setActiveModelIndex] = useState(-1)
  const [panelHeights, setPanelHeights] = useState({
    simple: 0,
    controls: 0,
    advanced: 0,
  })
  const [transitionsReady, setTransitionsReady] = useState(false)
  const [simplePanelNode, setSimplePanelNode] = useState<HTMLElement | null>(null)
  const [controlsNode, setControlsNode] = useState<HTMLElement | null>(null)
  const [advancedPanelNode, setAdvancedPanelNode] = useState<HTMLElement | null>(null)
  const modelTriggerRef = useRef<HTMLDivElement | null>(null)
  const thinkingTriggerRef = useRef<HTMLDivElement | null>(null)
  const providerTriggerRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const providerSearchTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  )
  const modelListboxId = useId()
  const modelOptionId = useId()

  const selectedProvider =
    providerOptions.find(provider => provider.providerID === selectedProviderID) ??
    providerOptions[0]
  const effectiveProviderID = selectedProvider?.providerID
  const selectedModel = selectedProvider?.modelPresets.find(
    preset => preset.id === selectedModelPreset,
  )
  const selectedModelLabel = selectedModel?.label ?? '未选择模型'
  const effectiveThinkingOptions = resolveThinkingOptions(
    deepSeekThinkingControls,
    thinkingOptions,
  )
  const selectedThinkingLabel = resolveThinkingLabel(
    effectiveThinkingOptions,
    thinkingPreviewMode ?? thinkingMode,
  )
  const effectivePickerView = showThinkingOptions ? pickerView : 'advanced'
  const activePanelHeight =
    panelHeights.controls + panelHeights[effectivePickerView]
  const currentModelSearch = effectiveProviderID
    ? (providerSearchQueries[effectiveProviderID] ?? '')
    : ''
  const activeModelDescendant =
    activeModelIndex >= 0 && activeModelIndex < (selectedProvider?.modelPresets.length ?? 0)
      ? `${modelOptionId}-${activeModelIndex}`
      : undefined
  const menuStyle = {
    '--simple-view-height': `${panelHeights.simple}px`,
    '--advanced-view-height': `${panelHeights.advanced}px`,
    height: activePanelHeight > 0 ? activePanelHeight : undefined,
  } as React.CSSProperties

  useLayoutEffect(() => {
    if (!open || !simplePanelNode || !controlsNode || !advancedPanelNode) {
      setTransitionsReady(false)
      return
    }

    const measure = (): typeof panelHeights => {
      const next = {
        simple: simplePanelNode.offsetHeight,
        controls: controlsNode.offsetHeight,
        advanced: advancedPanelNode.offsetHeight,
      }
      setPanelHeights(current =>
        current.simple === next.simple &&
        current.controls === next.controls &&
        current.advanced === next.advanced
          ? current
          : next,
      )
      return next
    }

    const initial = measure()
    const observer = new ResizeObserver(measure)
    observer.observe(simplePanelNode)
    observer.observe(controlsNode)
    observer.observe(advancedPanelNode)
    const hasMeasuredPanels =
      initial.simple > 0 && initial.controls > 0 && initial.advanced > 0
    const frame = hasMeasuredPanels
      ? window.requestAnimationFrame(() => setTransitionsReady(true))
      : null
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [advancedPanelNode, controlsNode, open, simplePanelNode])

  useEffect(
    () => () => {
      for (const timer of providerSearchTimersRef.current.values()) {
        clearTimeout(timer)
      }
      providerSearchTimersRef.current.clear()
    },
    [],
  )

  const queueProviderSearch = (
    providerID: ModelProviderID,
    query: string,
  ): void => {
    setProviderSearchQueries(current => ({
      ...current,
      [providerID]: query,
    }))
    const previous = providerSearchTimersRef.current.get(providerID)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      providerSearchTimersRef.current.delete(providerID)
      onProviderSearch?.(providerID, query.trim())
    }, 150)
    providerSearchTimersRef.current.set(providerID, timer)
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      setModelSubmenuOpen(false)
      setThinkingSubmenuOpen(false)
      setProviderSubmenuOpen(false)
      setActiveModelIndex(-1)
      setEndpointLabelsVisible(false)
    }
    onOpenChange(nextOpen)
  }

  const handleModelSelect = (modelID: string): void => {
    if (!effectiveProviderID) return
    onProviderModelChange(effectiveProviderID, modelID)
  }

  const moveActiveModel = (direction: 1 | -1): void => {
    const optionCount = selectedProvider?.modelPresets.length ?? 0
    if (optionCount === 0) return
    setActiveModelIndex(current => {
      if (current < 0) return direction > 0 ? 0 : optionCount - 1
      return (current + direction + optionCount) % optionCount
    })
  }

  const handleModelSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === 'Escape') {
      if (!currentModelSearch) return
      event.preventDefault()
      event.stopPropagation()
      if (effectiveProviderID) queueProviderSearch(effectiveProviderID, '')
      setActiveModelIndex(-1)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      moveActiveModel(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      const optionCount = selectedProvider?.modelPresets.length ?? 0
      setActiveModelIndex(event.key === 'Home' ? 0 : Math.max(0, optionCount - 1))
      return
    }
    if (event.key === 'Enter' && activeModelIndex >= 0) {
      const preset = selectedProvider?.modelPresets[activeModelIndex]
      if (!preset) return
      event.preventDefault()
      event.stopPropagation()
      handleModelSelect(preset.id)
      handleOpenChange(false)
      return
    }
    if (
      event.key.length === 1 ||
      event.key === 'Backspace' ||
      event.key === 'Delete'
    ) {
      event.stopPropagation()
    }
  }

  const togglePickerView = (): void => {
    setModelSubmenuOpen(false)
    setThinkingSubmenuOpen(false)
    setProviderSubmenuOpen(false)
    setEndpointLabelsVisible(false)
    setPickerView(current => (current === 'simple' ? 'advanced' : 'simple'))
  }

  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          aria-label="模型与推理设置"
          className="popover-surface popover rm-intelligence-picker tw:text-app-text"
          collisionPadding={6}
          data-theme-component="dropdown-surface"
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ width: 224 })}
        >
          <div
            className="rm-intelligence-menu"
            data-transitions-ready={transitionsReady || undefined}
            data-view={effectivePickerView}
            style={menuStyle}
          >
            <div className="rm-intelligence-view-track">
              <section
                ref={setSimplePanelNode}
                aria-hidden={effectivePickerView !== 'simple'}
                className="rm-intelligence-view-panel rm-intelligence-simple-view"
                data-active={effectivePickerView === 'simple'}
                inert={effectivePickerView !== 'simple'}
              >
                {showThinkingOptions ? (
                  <ThinkingLevelControl
                    deepSeekThinkingControls={deepSeekThinkingControls}
                    thinkingMode={thinkingMode}
                    thinkingOptions={thinkingOptions}
                    onThinkingChange={onThinkingChange}
                    onThinkingPreviewChange={onThinkingPreviewChange}
                    onEndpointLabelsVisibleChange={setEndpointLabelsVisible}
                  />
                ) : null}
              </section>

              <section
                ref={setControlsNode}
                className="rm-intelligence-view-controls"
                data-endpoint-labels-visible={endpointLabelsVisible || undefined}
                data-expanded={effectivePickerView === 'advanced'}
              >
                {showThinkingOptions ? (
                  <>
                    <DropdownMenu.Item
                      aria-expanded={effectivePickerView === 'advanced'}
                      aria-hidden={endpointLabelsVisible}
                      aria-label={
                        effectivePickerView === 'advanced'
                          ? '显示简洁模型选项'
                          : '显示高级模型选项'
                      }
                      className="popover-item rm-intelligence-view-toggle"
                      inert={endpointLabelsVisible}
                      onSelect={event => {
                        event.preventDefault()
                        togglePickerView()
                      }}
                    >
                      <span className="rm-intelligence-view-toggle-content">
                        <span>高级</span>
                        <ChevronRight
                          aria-hidden="true"
                          className="rm-intelligence-view-toggle-icon"
                          size={12}
                          strokeWidth={APP_ICON_STROKE_WIDTH}
                        />
                      </span>
                    </DropdownMenu.Item>
                    <div
                      aria-hidden={!endpointLabelsVisible}
                      className="rm-thinking-slider-endpoints"
                    >
                      <span>更高效</span>
                      <span>更智能</span>
                    </div>
                  </>
                ) : null}
              </section>

              <section
                ref={setAdvancedPanelNode}
                aria-hidden={effectivePickerView !== 'advanced'}
                className="rm-intelligence-view-panel rm-intelligence-advanced-view"
                data-active={effectivePickerView === 'advanced'}
                inert={effectivePickerView !== 'advanced'}
              >
                <DropdownMenu.Sub
                  open={modelSubmenuOpen}
                  onOpenChange={nextOpen => {
                    setModelSubmenuOpen(nextOpen)
                    setActiveModelIndex(-1)
                    if (nextOpen && effectiveProviderID) {
                      onProviderOpen?.(effectiveProviderID)
                    }
                  }}
                >
                  <IntelligenceSubmenuTrigger
                    ref={modelTriggerRef}
                    disabled={!effectiveProviderID}
                    label="模型"
                    value={selectedModelLabel}
                    onFocus={() => {
                      if (effectiveProviderID) onProviderOpen?.(effectiveProviderID)
                    }}
                    onPointerEnter={() => {
                      if (effectiveProviderID) onProviderOpen?.(effectiveProviderID)
                    }}
                  />
                  <IntelligenceSubmenuContent
                    className="rm-model-submenu"
                    contentLabel={`${selectedProvider?.displayName ?? '当前提供商'} 模型`}
                    onEscapeKeyDown={event => {
                      event.preventDefault()
                      setModelSubmenuOpen(false)
                      window.requestAnimationFrame(() => modelTriggerRef.current?.focus())
                    }}
                    width={280}
                  >
                    <DropdownMenu.Item
                      asChild
                      className="rm-model-search-item"
                      onSelect={event => event.preventDefault()}
                    >
                      <div
                        className="popover-search-region"
                        onFocus={event => {
                          if (event.target === event.currentTarget) {
                            searchRef.current?.focus()
                          }
                        }}
                      >
                        <SearchInput
                          ref={searchRef}
                          activeDescendant={activeModelDescendant}
                          aria-label="搜索当前提供商模型"
                          controls={modelListboxId}
                          expanded
                          mode="combobox"
                          placeholder="搜索模型…"
                          value={currentModelSearch}
                          variant="compact"
                          onChange={value => {
                            if (!effectiveProviderID) return
                            setActiveModelIndex(-1)
                            queueProviderSearch(effectiveProviderID, value)
                          }}
                          onKeyDown={handleModelSearchKeyDown}
                        />
                      </div>
                    </DropdownMenu.Item>
                    <div
                      aria-label={`${selectedProvider?.displayName ?? '当前提供商'} 模型`}
                      className="rm-intelligence-submenu-scroll-content rm-model-submenu-scroll-content"
                      id={modelListboxId}
                      role="listbox"
                    >
                      {(selectedProvider?.modelPresets.length ?? 0) === 0 ? (
                        <div className="popover-empty">加载模型中…</div>
                      ) : (
                        selectedProvider?.modelPresets.map((preset, index) => {
                          const selected = preset.id === selectedModelPreset
                          return (
                            <DropdownMenu.Item
                              key={preset.id}
                              aria-selected={selected}
                              className="popover-item rm-intelligence-option"
                              data-highlighted={activeModelIndex === index || undefined}
                              id={`${modelOptionId}-${index}`}
                              role="option"
                              onPointerMove={() => setActiveModelIndex(index)}
                              onSelect={() => handleModelSelect(preset.id)}
                            >
                              <span className="rm-item-label">{preset.label}</span>
                              {selected ? (
                                <Check
                                  className="rm-item-check"
                                  size={APP_ICON_SIZE}
                                  strokeWidth={APP_ICON_STROKE_WIDTH}
                                />
                              ) : null}
                            </DropdownMenu.Item>
                          )
                        })
                      )}
                    </div>
                  </IntelligenceSubmenuContent>
                </DropdownMenu.Sub>

                {showThinkingOptions ? (
                  <DropdownMenu.Sub
                    open={thinkingSubmenuOpen}
                    onOpenChange={setThinkingSubmenuOpen}
                  >
                    <IntelligenceSubmenuTrigger
                      ref={thinkingTriggerRef}
                      label="推理强度"
                      value={selectedThinkingLabel}
                    />
                    <IntelligenceSubmenuContent
                      contentLabel="选择推理强度"
                      onEscapeKeyDown={event => {
                        event.preventDefault()
                        setThinkingSubmenuOpen(false)
                        window.requestAnimationFrame(() =>
                          thinkingTriggerRef.current?.focus(),
                        )
                      }}
                      width={180}
                    >
                      <div className="rm-intelligence-submenu-scroll-content">
                        {effectiveThinkingOptions.map(option => {
                          const selected = option.value === thinkingMode
                          return (
                            <DropdownMenu.Item
                              key={option.value}
                              aria-checked={selected}
                              className="popover-item rm-intelligence-option"
                              role="menuitemradio"
                              onSelect={() => onThinkingChange(option.value)}
                            >
                              <span className="rm-item-label">{option.label}</span>
                              {selected ? (
                                <Check
                                  className="rm-item-check"
                                  size={APP_ICON_SIZE}
                                  strokeWidth={APP_ICON_STROKE_WIDTH}
                                />
                              ) : null}
                            </DropdownMenu.Item>
                          )
                        })}
                      </div>
                    </IntelligenceSubmenuContent>
                  </DropdownMenu.Sub>
                ) : null}

                <DropdownMenu.Sub
                  open={providerSubmenuOpen}
                  onOpenChange={nextOpen => {
                    setProviderSubmenuOpen(nextOpen)
                  }}
                >
                  <IntelligenceSubmenuTrigger
                    ref={providerTriggerRef}
                    label="提供商"
                    value={selectedProvider?.displayName ?? '未选择'}
                  />
                  <IntelligenceSubmenuContent
                    contentLabel="选择提供商"
                    onEscapeKeyDown={event => {
                      event.preventDefault()
                      setProviderSubmenuOpen(false)
                      window.requestAnimationFrame(() =>
                        providerTriggerRef.current?.focus(),
                      )
                    }}
                    width={233}
                  >
                    <div className="rm-intelligence-submenu-scroll-content">
                      {providerOptions.map(provider => {
                        const selected = provider.providerID === effectiveProviderID
                        const defaultPreset = provider.modelPresets[0]
                        return (
                          <DropdownMenu.Item
                            key={provider.providerID}
                            aria-checked={selected}
                            className="popover-item rm-intelligence-option"
                            disabled={!defaultPreset}
                            role="menuitemradio"
                            onFocus={() => onProviderOpen?.(provider.providerID)}
                            onPointerMove={() => onProviderOpen?.(provider.providerID)}
                            onSelect={event => {
                              event.preventDefault()
                              if (!selected && defaultPreset) {
                                onProviderModelChange(
                                  provider.providerID,
                                  defaultPreset.id,
                                )
                              }
                              setProviderSubmenuOpen(false)
                            }}
                          >
                            <span className="rm-item-label">{provider.displayName}</span>
                            {selected ? (
                              <Check
                                className="rm-item-check"
                                size={APP_ICON_SIZE}
                                strokeWidth={APP_ICON_STROKE_WIDTH}
                              />
                            ) : null}
                          </DropdownMenu.Item>
                        )
                      })}
                    </div>
                  </IntelligenceSubmenuContent>
                </DropdownMenu.Sub>
              </section>
            </div>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
