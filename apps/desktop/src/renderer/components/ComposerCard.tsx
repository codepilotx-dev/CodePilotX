import type React from 'react'
import { Mic, Plus, Send, Square } from 'lucide-react'
import type {
  DesktopPermissionMode,
  DesktopSessionStatus,
  DesktopThinkingMode,
} from '../../shared/types.js'
import type { ModelPreset } from '../modelPresets.js'

type Option<T extends string> = {
  value: T
  label: string
}

type Props = {
  input: string
  canSubmit: boolean
  sessionStatus: DesktopSessionStatus
  permissionMode: DesktopPermissionMode
  thinkingMode: DesktopThinkingMode
  selectedModelPreset: string
  modelPresets: ModelPreset[]
  permissionOptions: Option<DesktopPermissionMode>[]
  thinkingOptions: Option<DesktopThinkingMode>[]
  onInputChange: (value: string) => void
  onPermissionChange: (value: DesktopPermissionMode) => void
  onThinkingChange: (value: DesktopThinkingMode) => void
  onModelChange: (value: string) => void
  onSubmit: () => void
  onInterrupt: () => void
  onOpenFiles: () => void
}

export function ComposerCard({
  input,
  canSubmit,
  sessionStatus,
  permissionMode,
  thinkingMode,
  selectedModelPreset,
  modelPresets,
  permissionOptions,
  thinkingOptions,
  onInputChange,
  onPermissionChange,
  onThinkingChange,
  onModelChange,
  onSubmit,
  onInterrupt,
  onOpenFiles,
}: Props): React.ReactNode {
  return (
    <div className="composer-card">
      <textarea
        value={input}
        onChange={event => onInputChange(event.target.value)}
        placeholder="随心输入"
      />
      <div className="composer-card-actions">
        <div className="composer-card-left">
          <button className="ghost-icon-button" onClick={onOpenFiles} title="打开文件抽屉">
            <Plus size={18} />
          </button>
          <label className="composer-pill">
            <select
              value={permissionMode}
              onChange={event => onPermissionChange(event.target.value as DesktopPermissionMode)}
            >
              {permissionOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="composer-card-right">
          <label className="composer-inline-select">
            <span>模型</span>
            <select value={selectedModelPreset} onChange={event => onModelChange(event.target.value)}>
              {modelPresets.map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="__custom__">自定义模型…</option>
            </select>
          </label>
          <label className="composer-inline-select">
            <span>推理</span>
            <select
              value={thinkingMode}
              onChange={event => onThinkingChange(event.target.value as DesktopThinkingMode)}
            >
              {thinkingOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost-icon-button subtle"
            onClick={onInterrupt}
            disabled={sessionStatus !== 'running' && sessionStatus !== 'waiting'}
            title="停止当前执行"
          >
            <Square size={16} />
          </button>
          <button className="send-fab" onClick={onSubmit} disabled={!canSubmit}>
            <Send size={18} />
          </button>
          <span className="composer-mic">
            <Mic size={16} />
          </span>
        </div>
      </div>
    </div>
  )
}
