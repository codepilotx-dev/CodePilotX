import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DesktopThinkingMode } from '../../../../shared/types.js'
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'
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
  onThinkingPreviewChange?: (mode: DesktopThinkingMode | null) => void
  onEndpointLabelsVisibleChange?: (visible: boolean) => void
}

type ThickPillSliderProps = {
  options: ThinkingOption[]
  value: DesktopThinkingMode
  onChange: (value: DesktopThinkingMode) => void
  onPreviewChange?: (value: DesktopThinkingMode | null) => void
  onEndpointLabelsVisibleChange?: (visible: boolean) => void
}

const ENDPOINT_LABEL_HOLD_DELAY_MS = 150
const ENDPOINT_LABEL_DRAG_DISTANCE_PX = 4
const SLIDER_TRACK_PADDING_PX = 14
const SLIDER_MAGNET_RADIUS = 0.28
const SLIDER_MAGNET_STRENGTH = 0.45
const SLIDER_POSITION_TRANSITION = {
  duration: 0.15,
  ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
} as const
const SLIDER_EXTERNAL_POSITION_TRANSITION = {
  duration: 0.3,
  ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
} as const
const SLIDER_THUMB_ACTIVE_SPRING = {
  type: 'spring',
  stiffness: 420,
  damping: 38,
  mass: 1,
} as const
const SLIDER_THUMB_REST_SPRING = {
  type: 'spring',
  stiffness: 220,
  damping: 26,
  mass: 1,
} as const

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

export function resolveMagneticSliderPosition(
  rawIndex: number,
  stepCount: number,
): number {
  const safeStepCount = Math.max(0, stepCount)
  const clamped = Math.max(0, Math.min(safeStepCount, rawIndex))
  const anchor = Math.round(clamped)
  const distance = Math.abs(anchor - clamped)

  if (distance >= SLIDER_MAGNET_RADIUS) return clamped

  const proximity = 1 - distance / SLIDER_MAGNET_RADIUS
  const smoothPull = proximity * proximity * (3 - 2 * proximity)
  return clamped
    + (anchor - clamped) * smoothPull * SLIDER_MAGNET_STRENGTH
}

function normalizeSliderIndex(index: number, stepCount: number): number {
  return stepCount > 0 ? index / stepCount : 0
}

/** 直接跟随 Pointer，并仅在 Thumb 按压反馈上使用弹簧的厚胶囊离散滑块。 */
function ThickPillSlider({
  options,
  value,
  onChange,
  onPreviewChange,
  onEndpointLabelsVisibleChange,
}: ThickPillSliderProps): React.ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const endpointLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endpointLabelsVisibleRef = useRef(false)
  const previewIndexRef = useRef<number | null>(null)
  const pendingIndexRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const positionAnimationRef = useRef<ReturnType<typeof animate> | null>(null)
  const [isPointerDown, setIsPointerDown] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion()

  const resolvedCurrentIndex = options.findIndex(option => option.value === value)
  const currentIndex = Math.max(0, resolvedCurrentIndex)
  const totalSteps = options.length
  const stepCount = Math.max(0, totalSteps - 1)
  const activeIndex = Math.min(stepCount, previewIndex ?? currentIndex)
  const initialPosition = normalizeSliderIndex(currentIndex, stepCount)
  const position = useMotionValue(initialPosition)
  const trackTravel = useMotionValue(0)
  const rangeScaleX = useTransform(() => {
    const trackWidth = trackTravel.get() + 28
    if (trackWidth <= 0) return 0
    return (SLIDER_TRACK_PADDING_PX + position.get() * trackTravel.get()) / trackWidth
  })
  const thumbX = useTransform(() => position.get() * trackTravel.get())

  const stopPositionAnimation = useCallback((): void => {
    positionAnimationRef.current?.stop()
    positionAnimationRef.current = null
  }, [])

  const settlePosition = useCallback((index: number, quick = false): void => {
    const target = normalizeSliderIndex(index, stepCount)
    stopPositionAnimation()
    if (prefersReducedMotion || Math.abs(position.get() - target) < 0.0001) {
      position.set(target)
      return
    }
    positionAnimationRef.current = animate(position, target, {
      ...(quick ? SLIDER_POSITION_TRANSITION : SLIDER_EXTERNAL_POSITION_TRANSITION),
    })
  }, [position, prefersReducedMotion, stepCount, stopPositionAnimation])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const measure = (): void => {
      trackTravel.set(Math.max(0, track.getBoundingClientRect().width - 28))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [trackTravel])

  const computeRawIndex = (clientX: number): number => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const usableWidth = Math.max(1, rect.width - SLIDER_TRACK_PADDING_PX * 2)
    const offsetX = clientX - rect.left - SLIDER_TRACK_PADDING_PX
    const ratio = Math.max(0, Math.min(1, offsetX / usableWidth))
    return ratio * stepCount
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
    const rawIndex = computeRawIndex(clientX)
    const semanticIndex = Math.round(rawIndex)
    const magneticIndex = resolveMagneticSliderPosition(rawIndex, stepCount)
    position.set(normalizeSliderIndex(magneticIndex, stepCount))
    if (previewIndexRef.current !== semanticIndex) {
      previewIndexRef.current = semanticIndex
      setPreviewIndex(semanticIndex)
      const option = options[semanticIndex]
      if (option) onPreviewChange?.(option.value)
    }
    return semanticIndex
  }

  const finishPointerState = (pointerId: number): void => {
    clearEndpointLabelTimer()
    setEndpointLabelsVisible(false)
    activePointerRef.current = null
    pointerStartRef.current = null
    draggingRef.current = false
    setIsPointerDown(false)
    setIsDragging(false)
    if (trackRef.current?.hasPointerCapture(pointerId)) {
      trackRef.current.releasePointerCapture(pointerId)
    }
  }

  const commitPointerInteraction = (
    pointerId: number,
    snappedIndex: number,
  ): void => {
    const option = options[snappedIndex]
    previewIndexRef.current = snappedIndex
    settlePosition(snappedIndex, true)
    if (option && option.value !== value) {
      pendingIndexRef.current = snappedIndex
      onChange(option.value)
    } else {
      previewIndexRef.current = null
      pendingIndexRef.current = null
      setPreviewIndex(null)
      onPreviewChange?.(null)
    }
    finishPointerState(pointerId)
  }

  const cancelPointerInteraction = (pointerId: number): void => {
    previewIndexRef.current = null
    pendingIndexRef.current = null
    settlePosition(currentIndex, true)
    setPreviewIndex(null)
    onPreviewChange?.(null)
    finishPointerState(pointerId)
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
      stopPositionAnimation()
      position.set(normalizeSliderIndex(currentIndex, stepCount))
      setPreviewIndex(null)
      onPreviewChange?.(null)
      return
    }
    if (pendingIndex !== null && currentIndex === pendingIndex) {
      previewIndexRef.current = null
      pendingIndexRef.current = null
      setPreviewIndex(null)
      onPreviewChange?.(null)
    } else if (pendingIndex === null) {
      const hadPreview = previewIndexRef.current !== null
      previewIndexRef.current = null
      if (stepCount === 0) {
        stopPositionAnimation()
        position.set(0)
      } else {
        settlePosition(currentIndex)
      }
      setPreviewIndex(null)
      if (hadPreview) onPreviewChange?.(null)
    }
  }, [
    currentIndex,
    isPointerDown,
    options.length,
    position,
    resolvedCurrentIndex,
    onPreviewChange,
    settlePosition,
    stepCount,
    stopPositionAnimation,
  ])

  useEffect(
    () => () => {
      clearEndpointLabelTimer()
      stopPositionAnimation()
      onPreviewChange?.(null)
      if (endpointLabelsVisibleRef.current) {
        onEndpointLabelsVisibleChange?.(false)
      }
    },
    [onEndpointLabelsVisibleChange, onPreviewChange, stopPositionAnimation],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    activePointerRef.current = event.pointerId
    pointerStartRef.current = { x: event.clientX, y: event.clientY }
    draggingRef.current = false
    pendingIndexRef.current = null
    stopPositionAnimation()
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
      if (!draggingRef.current) {
        draggingRef.current = true
        setIsDragging(true)
      }
    }
    updateFromPointer(event.clientX)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== event.pointerId) return
    const snappedIndex = updateFromPointer(event.clientX)
    commitPointerInteraction(event.pointerId, snappedIndex)
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== event.pointerId) return
    cancelPointerInteraction(event.pointerId)
  }

  const handleLostPointerCapture = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (activePointerRef.current !== event.pointerId) return
    cancelPointerInteraction(event.pointerId)
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
        <motion.div
          className={cx(
            'rm-thick-slider-range',
            activeIndex === 0 && options[0]?.value === 'disabled' && 'is-disabled-level',
          )}
          style={{
            scaleX: rangeScaleX,
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

        <motion.div
          className="rm-thick-slider-thumb-rail"
          style={{
            x: thumbX,
          }}
        >
          <motion.div
            className="rm-thick-slider-thumb-spring"
            initial={false}
            animate={{ scale: !prefersReducedMotion && isPointerDown ? 32 / 28 : 1 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : isPointerDown
                  ? SLIDER_THUMB_ACTIVE_SPRING
                  : SLIDER_THUMB_REST_SPRING
            }
          >
            <span className="rm-thick-slider-thumb" />
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

export function ThinkingLevelControl({
  deepSeekThinkingControls,
  thinkingMode,
  thinkingOptions,
  onThinkingChange,
  onThinkingPreviewChange,
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
        onPreviewChange={onThinkingPreviewChange}
        onEndpointLabelsVisibleChange={onEndpointLabelsVisibleChange}
      />
    </div>
  )
}
