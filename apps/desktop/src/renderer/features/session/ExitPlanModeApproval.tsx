import type React from 'react'
import { useState } from 'react'
import * as Select from '@radix-ui/react-select'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CornerDownLeft,
  Pencil,
} from 'lucide-react'
import type {
  DesktopPermissionRequest,
} from '../../../shared/types.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { buildPopoverSizingStyle } from '../../components/ui/popoverSizing.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'

const DEFAULT_PLAN_EXECUTION_MODEL_VALUE = '__default_plan_execution_model__'

export type ExitPlanModeApprovalProps = {
  request: DesktopPermissionRequest
  onAccept: (options?: {
    note?: string
    planExecutionModel?: string
    savePlanExecutionModel?: boolean
  }) => void
  onRevise: () => void
}

export function ExitPlanModeApproval({
  onAccept,
  onRevise,
}: ExitPlanModeApprovalProps): React.ReactNode {
  const settings = useDesktopSettings()
  const [note, setNote] = useState('')
  const modelOptions = buildPlanExecutionModelOptions(settings)
  const [planExecutionModel, setPlanExecutionModel] = useState(
    settings.draft.values.planExecutionModel ||
      settings.defaultModel ||
      settings.model ||
      modelOptions[0]?.value ||
      '',
  )
  const [savePlanExecutionModel, setSavePlanExecutionModel] = useState(false)

  function handleAccept(): void {
    onAccept({
      note: note.trim() || undefined,
      planExecutionModel: planExecutionModel || undefined,
      savePlanExecutionModel,
    })
  }

  return (
    <div className="exit-plan-mode-approval">
      <div className="exit-plan-mode-title-row">
        <p className="exit-plan-mode-title">
          实施此计划?
        </p>
        <label className="exit-plan-mode-model">
          <span>使用</span>
          <Select.Root
            value={selectValueFromPlanExecutionModel(planExecutionModel)}
            onValueChange={value =>
              setPlanExecutionModel(planExecutionModelFromSelectValue(value))
            }
          >
            <Select.Trigger
              aria-label="计划执行模型"
              className="chip-button subtle composer-model-chip exit-plan-mode-model-trigger"
              title="计划执行模型"
            >
              <span className="permission-select-trigger-label composer-model-chip-label">
                {modelOptions.find(option => option.value === planExecutionModel)
                  ?.label ?? '默认'}
              </span>
              <Select.Icon asChild>
                <ChevronDown
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                align="start"
                className="popover-surface rm-model-menu exit-plan-mode-model-content"
                collisionPadding={12}
                position="popper"
                side="bottom"
                sideOffset={6}
                style={buildPopoverSizingStyle()}
              >
                <Select.Viewport className="permission-select-scroll-area">
                  <div className="permission-select-scroll-content">
                    {modelOptions.map(option => (
                      <Select.Item
                        className="rm-menu-item"
                        key={option.value || '__default__'}
                        value={selectValueFromPlanExecutionModel(option.value)}
                      >
                        <span className="rm-item-label">
                          <Select.ItemText>{option.label}</Select.ItemText>
                        </span>
                        <Select.ItemIndicator className="rm-item-check">
                          <Check
                            size={APP_ICON_SIZE}
                            strokeWidth={APP_ICON_STROKE_WIDTH}
                          />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </div>
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <span>模型</span>
        </label>
      </div>

      <div className="exit-plan-mode-options">
        <label className="exit-plan-mode-info">
          <input
            type="checkbox"
            checked={savePlanExecutionModel}
            onChange={event => setSavePlanExecutionModel(event.target.checked)}
          />
          <span>保存为默认计划执行模型</span>
        </label>
        <button
          className="exit-plan-mode-option selected"
          type="button"
          onClick={handleAccept}
        >
          <span className="exit-plan-mode-badge">1</span>
          <span className="exit-plan-mode-label">是，实施此计划</span>
          <span className="exit-plan-mode-arrows" aria-hidden="true">
            <ArrowUp size={14} />
            <ArrowDown size={14} />
          </span>
        </button>
      </div>

      <div className="exit-plan-mode-note-row">
        <div className="exit-plan-mode-note-wrap">
          <Pencil
            className="exit-plan-mode-note-icon"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          <input
            className="exit-plan-mode-note-input"
            placeholder="否，请告知 CodePilotX 如何调整"
            value={note}
            onChange={event => setNote(event.target.value)}
          />
        </div>
        <div className="exit-plan-mode-actions">
          <button
            className="exit-plan-mode-skip"
            type="button"
            onClick={onRevise}
          >
            <span>忽略</span>
            <kbd>ESC</kbd>
          </button>
          <button
            className="exit-plan-mode-submit"
            type="button"
            onClick={handleAccept}
          >
            <span>提交</span>
            <CornerDownLeft size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function selectValueFromPlanExecutionModel(value: string): string {
  return value || DEFAULT_PLAN_EXECUTION_MODEL_VALUE
}

function planExecutionModelFromSelectValue(value: string): string {
  return value === DEFAULT_PLAN_EXECUTION_MODEL_VALUE ? '' : value
}

function buildPlanExecutionModelOptions(settings: ReturnType<typeof useDesktopSettings>): Array<{
  value: string
  label: string
}> {
  const candidates = [
    settings.draft.values.planExecutionModel,
    settings.defaultModel,
    settings.model,
    settings.deepModel,
    settings.fastModel,
    settings.smallFastModel,
  ].filter((value): value is string => Boolean(value && value.trim()))
  const unique = Array.from(new Set(candidates))
  const options = unique.map(value => ({ value, label: value }))
  if (!options.some(option => option.value === '')) {
    options.unshift({ value: '', label: '默认' })
  }
  return options
}

export function extractPlanSummary(request: DesktopPermissionRequest): string {
  const input = request.input ?? {}
  const candidateKeys = ['plan', 'planMarkdown', 'summary', 'content', 'text']
  for (const key of candidateKeys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return ''
  }
}
