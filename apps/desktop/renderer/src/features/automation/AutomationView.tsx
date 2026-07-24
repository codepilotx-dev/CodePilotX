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
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { cx } from '../../utils/cx.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'

type QuickStart = {
  id: string
  label: string
  icon: React.ReactNode
}

const QUICK_STARTS: QuickStart[] = [
  { id: 'daily-brief', label: '每日简报', icon: <AlarmClock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} /> },
  { id: 'weekly-review', label: '每周回顾', icon: <CalendarClock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} /> },
  { id: 'project-monitor', label: '项目监控', icon: <FileSearch size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} /> },
]

export function AutomationView(): React.ReactNode {
  return (
    <section className="automation-view">
      <WorkspaceHeaderItem
        align="end"
        id="automation.actions"
        order={100}
        slot="right"
      >
        <div className="automation-header-actions">
          <button
            aria-label="查看自动化模板（尚未开放）"
            className="automation-button is-ghost"
            disabled
            type="button"
          >
            查看模板
            <span aria-hidden="true">尚未开放</span>
          </button>
          <button
            aria-label="通过聊天创建自动化（尚未开放）"
            className="automation-button is-primary"
            disabled
            type="button"
          >
            <Sparkles aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <span>通过聊天创建</span>
            <span aria-hidden="true">尚未开放</span>
            <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </button>
        </div>
      </WorkspaceHeaderItem>

      <header
        className={cx(
          'automation-header',
          'u-flex',
          'u-items-start',
          'u-justify-between',
          'u-flex-wrap',
        )}
      >
        <div className="automation-header-meta">
          <h1>自动化</h1>
          <p>
            按计划或按需运行聊天。<a href="#automation-docs">了解更多</a>
          </p>
        </div>

      </header>

      <div className="automation-canvas">
        <div
          className={cx(
            'automation-empty-state',
            'u-grid',
            'u-items-center',
            'u-gap-4',
          )}
        >
          <span className="automation-cloud" aria-hidden="true">
            <Cloud size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <span className="automation-cloud-prompt">
              <TerminalSquare size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </span>
          </span>
          <p
            className={cx(
              'automation-empty-title',
              'u-m-0',
              'u-type-body',
              'u-font-label',
              'u-text-primary',
            )}
          >
            创建首个自动化
          </p>
        </div>

        <ul className="automation-quick-starts" aria-label="快捷创建">
          {QUICK_STARTS.map(item => (
            <li key={item.id}>
              <button className="automation-quick-button" type="button">
                <span
                  className={cx(
                    'automation-quick-icon',
                    'u-inline-flex',
                    'u-items-center',
                    'u-text-primary',
                  )}
                >
                  {item.icon}
                </span>
                <span className="automation-quick-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
