import React from 'react'
import { Code2, Briefcase } from 'lucide-react'
import { RadioCard } from './RadioCard.js'
import { ToggleSwitch } from './ToggleSwitch.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import type { DesktopPermissionMode } from '../../shared/types.js'

type WorkMode = 'coding' | 'daily'

const WORK_MODES: Array<{
  value: WorkMode
  title: string
  description: string
  icon: React.ReactNode
}> = [
  {
    value: 'coding',
    title: '适用于编程',
    description: '更具技术性的回复和控制',
    icon: <Code2 />,
  },
  {
    value: 'daily',
    title: '适用于日常工作',
    description: '同样强大，技术细节更少',
    icon: <Briefcase />,
  },
]

const PERMISSION_LEVELS: Record<DesktopPermissionMode, number> = {
  default: 0,
  acceptEdits: 1,
  bypassPermissions: 2,
  dontAsk: 2,
}

function LearnMoreLink() {
  return (
    <a
      className="settings-row-link"
      href="#"
      onClick={e => e.preventDefault()}
    >
      了解更多有关高风险的信息。
    </a>
  )
}

export function GeneralSettings() {
  const { thinkingMode, setThinkingMode, permissionMode, setPermissionMode } =
    useDesktopSettings()

  const workMode: WorkMode = thinkingMode === 'adaptive' ? 'daily' : 'coding'
  const handleWorkMode = (next: WorkMode) => {
    setThinkingMode(next === 'coding' ? 'default' : 'adaptive')
  }

  const level = PERMISSION_LEVELS[permissionMode] ?? 0
  const defaultPermOn = level >= 0
  const autoApproveOn = level >= 1
  const fullAccessOn = level >= 2

  const handleAutoApprove = (checked: boolean) => {
    if (checked) setPermissionMode('acceptEdits')
    else setPermissionMode('default')
  }
  const handleFullAccess = (checked: boolean) => {
    if (checked) setPermissionMode('bypassPermissions')
    else setPermissionMode('acceptEdits')
  }

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">常规</h2>

        <section className="settings-section">
          <div className="settings-section-header">
            <h3 className="settings-section-title">工作模式</h3>
            <p className="settings-section-desc">选择 Codex 显示多少技术细节</p>
          </div>
          <div className="settings-radio-group">
            {WORK_MODES.map(mode => (
              <RadioCard
                key={mode.value}
                checked={workMode === mode.value}
                description={mode.description}
                icon={mode.icon}
                onClick={() => handleWorkMode(mode.value)}
                title={mode.title}
              />
            ))}
          </div>
        </section>

        <SettingsSection title="权限">
          <SettingsRow
            title="默认权限"
            description="默认情况下，Codex 可以读取并编辑其工作区中的文件。必要时，它可以请求额外的访问权限。"
            control={
              <ToggleSwitch
                checked={defaultPermOn}
                onChange={() => {}}
                ariaLabel="默认权限"
              />
            }
          />
          <SettingsRow
            title="自动审核"
            description={
              <>
                Codex 可以读取和编辑其工作区中的文件。Codex 会自动审核额外访问权限请求。自动审核可能会出错。
                <LearnMoreLink />
              </>
            }
            control={
              <ToggleSwitch
                checked={autoApproveOn}
                onChange={handleAutoApprove}
                ariaLabel="自动审核"
              />
            }
          />
          <SettingsRow
            title="完全访问权限"
            description={
              <>
                当 Codex 以完全访问权限运行时，无需你批准，即可编辑你的电脑上的任何文件并运行联网命令。这会显著增加数据丢失、泄露或意外行为的风险。
                <LearnMoreLink />
              </>
            }
            control={
              <ToggleSwitch
                checked={fullAccessOn}
                onChange={handleFullAccess}
                ariaLabel="完全访问权限"
              />
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}
