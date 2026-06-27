import type React from 'react'
import { useMemo, useState } from 'react'
import { ChevronDown, CornerDownLeft, Info, ListChecks, ShieldCheck, X } from 'lucide-react'
import type {
  DesktopPermissionMode,
  DesktopPermissionRequest,
} from '../../../shared/types.js'
import { PERMISSION_MODE_OPTIONS } from '../settings/settingsStorage.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'

type Choice = DesktopPermissionMode

const POST_PLAN_MODE_OPTIONS = PERMISSION_MODE_OPTIONS.filter(
  option => option.value !== 'plan',
)

type PlanConfirmOption = {
  id: 'implement' | 'revise'
  label: string
}

const PLAN_CONFIRM_OPTIONS: PlanConfirmOption[] = [
  { id: 'implement', label: '是，实施此计划' },
  { id: 'revise', label: '否，请告知 Codex 如何调整' },
]

export type ExitPlanModeApprovalProps = {
  request: DesktopPermissionRequest
  currentMode?: DesktopPermissionMode
  onAccept: (nextMode: Choice, note?: string) => void
  onRevise: () => void
}

export function ExitPlanModeApproval({
  request,
  currentMode = 'default',
  onAccept,
  onRevise,
}: ExitPlanModeApprovalProps): React.ReactNode {
  const fallback: Choice = useMemo(
    () => (currentMode === 'plan' ? 'default' : currentMode),
    [currentMode],
  )
  const [selected, setSelected] = useState<PlanConfirmOption['id']>('implement')
  const [postMode, setPostMode] = useState<Choice>(fallback)
  const [menuOpen, setMenuOpen] = useState(false)
  const [note, setNote] = useState('')

  const summary = extractPlanSummary(request)

  function handleAccept(): void {
    onAccept(postMode, note.trim() || undefined)
  }

  function handleRevise(): void {
    onRevise()
  }

  return (
    <div className="exit-plan-mode-approval">
      <p className="exit-plan-mode-title">
        CodePilotX 已生成完整计划，确认接受后退出计划模式
      </p>

      <div className="exit-plan-mode-options" role="radiogroup">
        {PLAN_CONFIRM_OPTIONS.map((option, idx) => (
          <button
            aria-checked={selected === option.id}
            className={
              selected === option.id
                ? 'exit-plan-mode-option selected'
                : 'exit-plan-mode-option'
            }
            key={option.id}
            onClick={() => setSelected(option.id)}
            role="radio"
            type="button"
          >
            <span className="exit-plan-mode-badge">{idx + 1}</span>
            <span className="exit-plan-mode-label">{option.label}</span>
            <span className="exit-plan-mode-info" aria-hidden="true">
              <Info size={14} />
            </span>
          </button>
        ))}
      </div>

      <div className="exit-plan-mode-fixed-option">
        <div className="exit-plan-mode-note-row">
          <div className="exit-plan-mode-note-wrap">
            <textarea
              className="exit-plan-mode-note-input"
              placeholder="请告知 Codex 如何调整"
              rows={1}
              value={note}
              onChange={event => setNote(event.target.value)}
            />
          </div>

          <div className="exit-plan-mode-actions">
            <button
              className="exit-plan-mode-skip"
              type="button"
              onClick={handleRevise}
            >
              <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              <span>继续修改</span>
            </button>
            <button
              className="exit-plan-mode-submit"
              type="button"
              onClick={handleAccept}
            >
              <ListChecks
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
              <span>接受并继续</span>
              <CornerDownLeft size={14} />
            </button>
          </div>
        </div>

        <label className="exit-plan-mode-mode-picker">
          <span className="exit-plan-mode-mode-label">后续权限</span>
          <button
            aria-expanded={menuOpen}
            className="exit-plan-mode-mode-trigger"
            type="button"
            onClick={() => setMenuOpen(value => !value)}
          >
            <ShieldCheck
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span>{describeMode(postMode)}</span>
            <ChevronDown
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </button>
          {menuOpen ? (
            <ul className="exit-plan-mode-mode-menu" role="menu">
              {POST_PLAN_MODE_OPTIONS.map(option => (
                <li key={option.value} role="none">
                  <button
                    aria-checked={option.value === postMode}
                    className={
                      option.value === postMode
                        ? 'exit-plan-mode-mode-option is-selected'
                        : 'exit-plan-mode-mode-option'
                    }
                    role="menuitemradio"
                    type="button"
                    onClick={() => {
                      setPostMode(option.value)
                      setMenuOpen(false)
                    }}
                  >
                    <span className="exit-plan-mode-mode-option-label">
                      {option.label}
                    </span>
                    <span className="exit-plan-mode-mode-option-detail">
                      {option.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </label>
      </div>

      {summary ? (
        <details className="exit-plan-mode-summary-panel">
          <summary>查看计划摘要</summary>
          <pre className="exit-plan-mode-summary">{summary}</pre>
        </details>
      ) : null}
    </div>
  )
}

function describeMode(mode: Choice): string {
  return POST_PLAN_MODE_OPTIONS.find(option => option.value === mode)?.label ??
    PERMISSION_MODE_OPTIONS.find(option => option.value === mode)?.label ??
    mode
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
