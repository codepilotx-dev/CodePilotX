import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../../utils/cx.js'
import { ReasoningMenu } from './ReasoningMenu.js'
import type { ThinkingOption } from './ThinkingLevelPopover.js'

export type ModelSelectTriggerProps = {
  modelName: string
  tooltipTitle?: string
  loading?: boolean
  isOpen?: boolean
  onToggleOpen?: () => void
  showThinkingOptions?: boolean
  thinkingLabel?: string
  thinkingMode?: string
  thinkingPreviewMode?: string | null
  thinkingOptions?: ThinkingOption[]
  onThinkingChange?: (mode: string) => void
  onThinkingPreviewChange?: (mode: string | null) => void
  className?: string
  id?: string
}

export const ModelSelectTrigger = React.forwardRef<
  HTMLDivElement,
  ModelSelectTriggerProps
>(function ModelSelectTrigger(
  {
    modelName,
    tooltipTitle,
    isOpen = false,
    onToggleOpen,
    showThinkingOptions = false,
    thinkingLabel,
    thinkingMode = 'default',
    thinkingPreviewMode,
    thinkingOptions = [],
    onThinkingChange,
    onThinkingPreviewChange,
    className = '',
    id = 'model-select-trigger',
  },
  ref,
) {
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)

  const active = isOpen || effortMenuOpen

  return (
    <div
      ref={ref}
      id={id}
      className={cx(
        'composer-model-trigger-capsule',
        active && 'is-active',
        className,
      )}
      onClick={onToggleOpen}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={tooltipTitle}
        aria-label={
          showThinkingOptions && thinkingLabel
            ? `模型与推理设置：${modelName}，${thinkingLabel}`
            : `模型：${modelName}`
        }
        className="composer-model-trigger-name-btn"
        onClick={event => {
          // Let the parent container's onClick handle it or trigger directly
          if (onToggleOpen) {
            event.stopPropagation()
            onToggleOpen()
          }
        }}
      >
        <span className="composer-model-trigger-name">{modelName}</span>
      </button>

      {showThinkingOptions && thinkingLabel && onThinkingChange ? (
        <div
          className="composer-model-trigger-effort-wrap"
          onClick={event => event.stopPropagation()}
        >
          <ReasoningMenu
            open={effortMenuOpen}
            onOpenChange={setEffortMenuOpen}
            thinkingMode={thinkingMode}
            thinkingPreviewMode={thinkingPreviewMode}
            thinkingOptions={thinkingOptions}
            onThinkingChange={onThinkingChange}
            onThinkingPreviewChange={onThinkingPreviewChange}
            side="top"
            sideOffset={8}
            align="center"
            trigger={
              <button
                type="button"
                className="composer-model-trigger-effort-btn"
                title="点击选择推理思考强度"
                aria-label={`推理思考强度：${thinkingLabel}`}
              >
                <span>{thinkingLabel}</span>
              </button>
            }
          />
        </div>
      ) : null}

      <span
        aria-hidden="true"
        className="composer-model-trigger-chevron-wrap"
      >
        <ChevronDown
          size={14}
          strokeWidth={2.4}
          className={cx(
            'composer-model-trigger-chevron',
            isOpen && 'is-open',
          )}
        />
      </span>
    </div>
  )
})
