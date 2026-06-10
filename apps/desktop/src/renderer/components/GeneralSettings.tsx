import React from 'react'
import { Code2, Briefcase } from 'lucide-react'
import { RadioCard } from './RadioCard.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'

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

export function GeneralSettings() {
  const { thinkingMode, setThinkingMode } = useDesktopSettings()
  const workMode: WorkMode = thinkingMode === 'adaptive' ? 'daily' : 'coding'
  const handleWorkMode = (next: WorkMode) => {
    setThinkingMode(next === 'coding' ? 'default' : 'adaptive')
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
      </div>
    </div>
  )
}
