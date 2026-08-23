import React, { useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { DesktopThinkingMode } from '../../../../shared/types.js'
import { buildPopoverSizingStyle } from '../../../components/ui/popoverSizing.js'
import { cx } from '../../../utils/cx.js'

export type ThinkingOption = {
  value: DesktopThinkingMode
  label: string
}

export type ThinkingLevelPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactElement
  deepSeekThinkingControls: boolean
  thinkingMode: DesktopThinkingMode
  thinkingOptions: ThinkingOption[]
  onThinkingChange: (mode: DesktopThinkingMode) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

type ThickPillSliderProps = {
  options: ThinkingOption[]
  value: DesktopThinkingMode
  onChange: (value: DesktopThinkingMode) => void
}

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
}: ThickPillSliderProps): React.ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragProgress, setDragProgress] = useState<number | null>(null)

  const currentIndex = Math.max(
    0,
    options.findIndex(option => option.value === value),
  )
  const totalSteps = options.length
  const stepCount = Math.max(1, totalSteps - 1)
  const activeRatio =
    dragProgress !== null ? dragProgress : totalSteps > 1 ? currentIndex / stepCount : 0
  const activeIndex = Math.round(activeRatio * stepCount)

  const computeRatio = (clientX: number): number => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const trackPadding = 16
    const usableWidth = Math.max(1, rect.width - trackPadding * 2)
    const offsetX = clientX - rect.left - trackPadding
    return Math.max(0, Math.min(1, offsetX / usableWidth))
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    trackRef.current?.setPointerCapture(event.pointerId)
    setIsDragging(true)
    const ratio = computeRatio(event.clientX)
    setDragProgress(ratio)
    const targetIndex = Math.round(ratio * stepCount)
    if (options[targetIndex] && options[targetIndex].value !== value) {
      onChange(options[targetIndex].value)
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    const ratio = computeRatio(event.clientX)
    setDragProgress(ratio)
    const targetIndex = Math.round(ratio * stepCount)
    if (options[targetIndex] && options[targetIndex].value !== value) {
      onChange(options[targetIndex].value)
    }
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    try {
      trackRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    const ratio = computeRatio(event.clientX)
    const targetIndex = Math.round(ratio * stepCount)
    setIsDragging(false)
    setDragProgress(null)
    if (options[targetIndex]) onChange(options[targetIndex].value)
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
        className={cx('rm-thick-slider-track', isDragging && 'is-dragging')}
        role="slider"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerCancel={handlePointerUp}
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
            width: `calc(16px + (100% - 32px) * ${activeRatio})`,
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
                left: `calc(16px + (100% - 32px) * ${dotRatio})`,
              }}
            />
          )
        })}

        <div
          className={cx('rm-thick-slider-thumb', isDragging && 'is-dragging')}
          style={{
            left: `calc(-2px + (100% - 32px) * ${activeRatio})`,
          }}
        />
      </div>
    </div>
  )
}

export function ThinkingLevelPopover({
  open,
  onOpenChange,
  trigger,
  deepSeekThinkingControls,
  thinkingMode,
  thinkingOptions,
  onThinkingChange,
  align = 'end',
  side = 'top',
  sideOffset = 6,
}: ThinkingLevelPopoverProps): React.ReactNode {
  const effectiveOptions = resolveThinkingOptions(
    deepSeekThinkingControls,
    thinkingOptions,
  )
  const currentLabel = resolveThinkingLabel(effectiveOptions, thinkingMode)

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          aria-label="思考等级"
          className="popover-surface rm-thinking-level-panel tw:text-app-text"
          collisionPadding={8}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ width: 240 })}
          onOpenAutoFocus={event => {
            event.preventDefault()
          }}
        >
          <div className="rm-thinking-current-value">{currentLabel}</div>
          <ThickPillSlider
            options={effectiveOptions}
            value={thinkingMode}
            onChange={onThinkingChange}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
