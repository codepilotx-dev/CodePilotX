import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import type { PermissionMode } from '../domain/task-flow'

const options: Array<{ value: PermissionMode; label: string; icon: typeof ShieldCheck }> = [
  { value: 'ask', label: '每次确认', icon: ShieldAlert },
  { value: 'review', label: '自动 AI 审查', icon: ShieldCheck },
  { value: 'full', label: '完全访问', icon: ShieldOff },
]

export function PermissionModeSlider({ value, onChange }: { value: PermissionMode; onChange: (mode: PermissionMode) => void }) {
  return (
    <div className="permission-slider" role="radiogroup" aria-label="工具权限模式">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            className={value === option.value ? 'permission-option permission-option-active' : 'permission-option'}
            onClick={() => onChange(option.value)}
            role="radio"
            aria-checked={value === option.value}
            title={option.value === 'ask' ? '每次工具调用前询问' : option.value === 'review' ? '由独立模型审查，高风险时询问' : '按当前 Windows 用户权限直接执行'}
          >
            <Icon size={13} /> {option.label}
          </button>
        )
      })}
    </div>
  )
}
