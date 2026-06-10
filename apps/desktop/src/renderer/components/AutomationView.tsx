import type React from 'react'
import {
  AlarmClock,
  CalendarClock,
  ChevronDown,
  Cloud,
  FileSearch,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'

type QuickStart = {
  id: string
  label: string
  icon: React.ReactNode
}

const QUICK_STARTS: QuickStart[] = [
  { id: 'daily-brief', label: '每日简报', icon: <AlarmClock size={15} strokeWidth={2} /> },
  { id: 'weekly-review', label: '每周回顾', icon: <CalendarClock size={15} strokeWidth={2} /> },
  { id: 'project-monitor', label: '项目监控', icon: <FileSearch size={15} strokeWidth={2} /> },
]

export function AutomationView(): React.ReactNode {
  return (
    <section className="automation-view">
      <header className="automation-header">
        <div className="automation-header-meta">
          <h1>自动化</h1>
          <p>
            按计划或按需运行聊天。<a href="#automation-docs">了解更多</a>
          </p>
        </div>

        <div className="automation-header-actions">
          <button className="automation-button is-ghost" type="button">
            查看模板
          </button>
          <button className="automation-button is-primary" type="button">
            <Sparkles size={14} strokeWidth={2.2} />
            <span>通过聊天创建</span>
            <ChevronDown size={13} strokeWidth={2.2} />
          </button>
        </div>
      </header>

      <div className="automation-canvas">
        <div className="automation-empty-state">
          <span className="automation-cloud" aria-hidden="true">
            <Cloud size={120} strokeWidth={1.4} />
            <span className="automation-cloud-prompt">
              <TerminalSquare size={26} strokeWidth={2} />
            </span>
          </span>
          <p className="automation-empty-title">创建首个自动化</p>
        </div>

        <ul className="automation-quick-starts" aria-label="快捷创建">
          {QUICK_STARTS.map(item => (
            <li key={item.id}>
              <button className="automation-quick-button" type="button">
                <span className="automation-quick-icon">{item.icon}</span>
                <span className="automation-quick-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}