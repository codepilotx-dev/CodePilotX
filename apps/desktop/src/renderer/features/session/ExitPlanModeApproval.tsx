import type React from 'react'
import { useState } from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Pencil } from 'lucide-react'
import type {
  DesktopPermissionRequest,
} from '../../../shared/types.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'

export type ExitPlanModeApprovalProps = {
  request: DesktopPermissionRequest
  onAccept: (note?: string) => void
  onRevise: () => void
}

export function ExitPlanModeApproval({
  onAccept,
  onRevise,
}: ExitPlanModeApprovalProps): React.ReactNode {
  const [note, setNote] = useState('')

  function handleAccept(): void {
    onAccept(note.trim() || undefined)
  }

  return (
    <div className="exit-plan-mode-approval">
      <p className="exit-plan-mode-title">
        实施此计划?
      </p>

      <div className="exit-plan-mode-options">
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
            placeholder="否，请告知 Codex 如何调整"
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
