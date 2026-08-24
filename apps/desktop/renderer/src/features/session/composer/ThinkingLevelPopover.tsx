import React, { useEffect, useRef, useState } from 'react'
import type { DesktopThinkingMode } from '../../../../shared/types.js'
import { cx } from '../../../utils/cx.js'

export type ThinkingOption = {
  value: DesktopThinkingMode
  label: string
}

export type ThinkingLevelControlProps = {
  deepSeekThinkingControls: boolean
  thinkingMode: DesktopThinkingMode
  thinkingOptions: ThinkingOption[]
  onThinkingChange: (mode: DesktopThinkingMode) => void
  onEndpointLabelsVisibleChange?: (visible: boolean) => void
}

type ThickPillSliderProps = {
  options: ThinkingOption[]
  value: DesktopThinkingMode
  onChange: (value: DesktopThinkingMode) => void
  onEndpointLabelsVisibleChange?: (visible: boolean) => void
}

const ENDPOINT_LABEL_HOLD_DELAY_MS = 150
const ENDPOINT_LABEL_DRAG_DISTANCE_PX = 4

const DEEPSEEK_THINKING_OPTIONS: ThinkingOption[] = [
  { value: 'disabled', label: '关闭' },
  { value: 'default', label: '高' },
  { value: 'enabled', label: '超高' },
]

export function resolveThinkingOptions(
  deepSeekThinkingControls: boolean,
  thinkingOptions: ThinkingOption[],
): ThinkingOption[] {
  return deepSeekThinkingControls ? DEEPSEEK_THINKING_OPTIONS : thinkingOptions
}

export function resolveThinkingLabel(
  options: ThinkingOption[],
  thinkingMode: DesktopThinkingMode,
): string {
  return options.find(option => option.value === thinkingMode)?.label ?? '默认'
}

/**
 * 具有物理阻尼感（Damped Spring）与零闪烁 Pointer Capture 的厚胶囊离散滑块
 */
function ThickPillSlider({
  options,
  value,
  onChange,
  onEndpointLabelsVisibleChange,
}: ThickPillSliderProps): React.ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const endpointLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endpointLabelsVisibleRef = useRef(false)
  const previewIndexRef = useRef<number | null>(null)
  const lastEmittedIndexRef = useRef<number | null>(null)
  const pendingIndexRef = useRef<number | null>(null)
  const [isPointerDown, setIsPointerDown] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const resolvedCurrentIndex = options.findIndex(option => option.value === value)
  const currentIndex = Math.max(0, resolvedCurrentIndex)
  const totalSteps = options.length
  const stepCount = Math.max(1, totalSteps - 1)
  const activeIndex = Math.min(stepCount, previewIndex ?? currentIndex)
  const activeRatio = totalSteps > 1 ? activeIndex / stepCount : 0

  const computeIndex = (clientX: number): number => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const trackPadding = 14
    const usableWidth = Math.max(1, rect.width - trackPadding * 2)
    const offsetX = clientX - rect.left - trackPadding
    const ratio = Math.max(0, Math.min(1, offsetX / usableWidth))
    return Math.round(ratio * stepCount)
  }

  const clearEndpointLabelTimer = (): void => {
    if (endpointLabelTimerRef.current === null) return
    clearTimeout(endpointLabelTimerRef.current)
    endpointLabelTimerRef.current = null
  }

  const setEndpointLabelsVisible = (visible: boolean): void => {
    if (endpointLabelsVisibleRef.current === visible) return
    endpointLabelsVisibleRef.current = visible
    onEndpointLabelsVisibleChange?.(visible)
  }

  const updateFromPointer = (clientX: number): number => {
    const targetIndex = computeIndex(clientX)
    previewIndexRef.current = targetIndex
    setPreviewIndex(targetIndex)
    if (lastEmittedIndexRef.current !== targetIndex && options[targetIndex]) {
      lastEmittedIndexRef.current = targetIndex
      onChange(options[targetIndex].value)
    }
    return targetIndex
  }

  const finishPointerInteraction = (pointerId: number): void => {
    clearEndpointLabelTimer()
    setEndpointLabelsVisible(false)
    activePointerRef.current = null
    pointerStartRef.current = null
    pendingIndexRef.current = previewIndexRef.current
    setIsPointerDown(false)
    setIsDragging(false)
    if (trackRef.current?.hasPointerCapture(pointerId)) {
      trackRef.current.releasePointerCapture(pointerId)
    }
  }

  useEffect(() => {
    const pendingIndex = pendingIndexRef.current
    if (isPointerDown) return
    if (
      previewIndexRef.current !== null &&
      (previewIndexRef.current >= options.length || resolvedCurrentIndex < 0)
    ) {
      previewIndexRef.current = null
      pendingIndexRef.current = null
      lastEmittedIndexRef.current = currentIndex
      setPreviewIndex(null)
      return
    }
    if (pendingIndex !== null && currentIndex === pendingIndex) {
      previewIndexRef.current = null
      pendingIndexRef.current = null
      lastEmittedIndexRef.current = currentIndex
      setPreviewIndex(null)
    } else if (pendingIndex === null) {
      previewIndexRef.current = null
      lastEmittedIndexRef.current = currentIndex
      setPreviewIndex(null)
    }
  }, [currentIndex, isPointerDown, options.length, resolvedCurrentIndex])

  useEffect(
    () => () => {
      clearEndpointLabelTimer()
      if (endpointLabelsVisibleRef.current) {
        onEndpointLabelsVisibleChange?.(false)
      }
    },
    [onEndpointLabelsVisibleChange],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    activePointerRef.current = event.pointerId
    pointerStartRef.current = { x: event.clientX, y: event.clientY }
    pendingIndexRef.current = null
    lastEmittedIndexRef.current = currentIndex
    trackRef.current?.setPointerCapture(event.pointerId)
    setIsPointerDown(true)
    updateFromPointer(event.clientX)
    clearEndpointLabelTimer()
    endpointLabelTimerRef.current = setTimeout(() => {
      endpointLabelTimerRef.current = null
      if (activePointerRef.current === event.pointerId) {
        setEndpointLabelsVisible(true)
      }
    }, ENDPOINT_LABEL_HOLD_DELAY_MS)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== event.pointerId || event.buttons === 0) return
    const start = pointerStartRef.current
    if (
      start &&
      (event.clientX - start.x) ** 2 + (event.clientY - start.y) ** 2 >=
        ENDPOINT_LABEL_DRAG_DISTANCE_PX ** 2
    ) {
      clearEndpointLabelTimer()
      setEndpointLabelsVisible(true)
    }
    setIsDragging(true)
    updateFromPointer(event.clientX)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== event.pointerId) return
    updateFromPointer(event.clientX)
    finishPointerInteraction(event.pointerId)
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== event.pointerId) return
    finishPointerInteraction(event.pointerId)
  }

  const handleLostPointerCapture = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (activePointerRef.current !== event.pointerId) return
    finishPointerInteraction(event.pointerId)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      const nextIndex = Math.min(stepCount, currentIndex + 1)
      if (options[nextIndex]) onChange(options[nextIndex].value)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = Math.max(0, currentIndex - 1)
      if (options[nextIndex]) onChange(options[nextIndex].value)
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (options[0]) onChange(options[0].value)
    } else if (event.key === 'End') {
      event.preventDefault()
      if (options[stepCount]) onChange(options[stepCount].value)
    }
  }

  return (
    <div className="rm-picker-thick-slider-container">
      <div
        ref={trackRef}
        aria-label="调节思考等级"
        aria-valuemax={stepCount}
        aria-valuemin={0}
        aria-valuenow={activeIndex}
        aria-valuetext={options[activeIndex]?.label}
        className={cx(
          'rm-thick-slider-track',
          isPointerDown && 'is-pointer-down',
          isDragging && 'is-dragging',
        )}
        role="slider"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onLostPointerCapture={handleLostPointerCapture}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className={cx(
            'rm-thick-slider-range',
            isDragging && 'is-dragging',
            activeIndex === 0 && options[0]?.value === 'disabled' && 'is-disabled-level',
          )}
          style={{
            width: `calc(14px + (100% - 28px) * ${activeRatio})`,
          }}
        />

        {options.map((option, index) => {
          const dotRatio = stepCount > 0 ? index / stepCount : 0
          return (
            <span
              key={option.value}
              className={cx(
                'rm-thick-slider-dot',
                index <= activeIndex && 'is-passed',
                index === activeIndex && 'is-current',
              )}
              style={{
                left: `calc(14px + (100% - 28px) * ${dotRatio})`,
              }}
            />
          )
        })}

        <div
          className={cx('rm-thick-slider-thumb', isDragging && 'is-dragging')}
          style={{
            left: `calc((100% - 28px) * ${activeRatio})`,
          }}
        />
      </div>
    </div>
  )
}

export function ThinkingLevelControl({
  deepSeekThinkingControls,
  thinkingMode,
  thinkingOptions,
  onThinkingChange,
  onEndpointLabelsVisibleChange,
}: ThinkingLevelControlProps): React.ReactNode {
  const effectiveOptions = resolveThinkingOptions(
    deepSeekThinkingControls,
    thinkingOptions,
  )
  return (
    <div className="rm-thinking-level-control">
      <ThickPillSlider
        options={effectiveOptions}
        value={thinkingMode}
        onChange={onThinkingChange}
        onEndpointLabelsVisibleChange={onEndpointLabelsVisibleChange}
      />
    </div>
  )
}
