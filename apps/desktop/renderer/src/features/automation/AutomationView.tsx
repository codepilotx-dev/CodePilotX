import { useState } from 'react'
import type React from 'react'
import {
  AlarmClock,
  CalendarClock,
  ChevronDown,
  FileSearch,
  Sparkles,
} from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'

type AutomationStatus = 'all' | 'enabled' | 'paused' | 'completed'

type QuickStart = {
  id: string
  label: string
  schedule: string
  description: string
  icon: React.ReactNode
}

const STATUS_OPTIONS: Array<{ value: AutomationStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已开启' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
]

const QUICK_STARTS: QuickStart[] = [
  {
    id: 'daily-brief',
    label: '每日简报',
    schedule: '工作日 8:00',
    description: '汇总日历、未读消息和优先事项，开启每个工作日。',
    icon: <AlarmClock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    id: 'weekly-review',
    label: '每周回顾',
    schedule: '星期五 16:00',
    description: '将本周最近的工作整理成简明的状态更新。',
    icon: <CalendarClock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    id: 'project-monitor',
    label: '项目监控',
    schedule: '工作日 9:00',
    description: '查看最近的项目活动，并标记需要关注的事项。',
    icon: <FileSearch size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
]

export function AutomationView(): React.ReactNode {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AutomationStatus>('all')

  return (
    <>
      <WorkspaceHeaderItem align="end" id="automation.actions" order={100} slot="right">
        <div className="automation-header-actions">
          <Button aria-label="查看自动化模板（尚未开放）" color="secondary" disabled>
            查看模板
            <span aria-hidden="true">尚未开放</span>
          </Button>
          <Button aria-label="通过聊天创建自动化（尚未开放）" color="primary" disabled>
            <Sparkles aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <span>通过聊天创建</span>
            <span aria-hidden="true">尚未开放</span>
            <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
        </div>
      </WorkspaceHeaderItem>
      <PrimaryPageLayout
        bodyClassName="automation-view"
        description="让 CodePilotX 安排任务、设置提醒或监测更新。"
        navigation={(
          <SegmentedControl<AutomationStatus>
            ariaLabel="自动化状态"
            getPanelId={value => `automation-${value}-panel`}
            getTabId={value => `automation-${value}-tab`}
            onChange={setStatus}
            options={STATUS_OPTIONS}
            semantics="tabs"
            value={status}
          />
        )}
        search={(
          <SearchInput
            aria-label="搜索已安排任务"
            onChange={setQuery}
            placeholder="搜索已安排任务"
            value={query}
          />
        )}
        title="已安排的任务"
      >
        <div
          aria-labelledby={`automation-${status}-tab`}
          className="automation-content"
          id={`automation-${status}-panel`}
          role="tabpanel"
        >
          <div className="automation-empty-state">
            <CalendarClock aria-hidden="true" size={32} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <h2>暂无已安排任务</h2>
            <p>{query ? `没有与“${query}”匹配的任务。` : '创建任务后，它们会按状态显示在这里。'}</p>
          </div>

          <section className="automation-suggestions" aria-labelledby="automation-suggestions-title">
            <h2 id="automation-suggestions-title">建议</h2>
            <ul>
              {QUICK_STARTS.map(item => (
                <li key={item.id}>
                  <span className="automation-suggestion-icon" aria-hidden="true">{item.icon}</span>
                  <span className="automation-suggestion-copy">
                    <span>
                      <strong>{item.label}</strong>
                      <span>{item.schedule}</span>
                    </span>
                    <small>{item.description}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </PrimaryPageLayout>
    </>
  )
}
