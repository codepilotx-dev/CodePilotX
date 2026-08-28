import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Automation, AutomationRun } from '@codepilotx/shared/automation'
import {
  AUTOMATION_TEMPLATES,
  defaultAutomationDraft,
  isCompletedAutomation,
} from '../src/features/automation/automationModel.js'

const viewSource = readFileSync(
  new URL('../src/features/automation/AutomationView.tsx', import.meta.url),
  'utf8',
)
const styleSource = readFileSync(
  new URL('../src/styles/features/automation.scss', import.meta.url),
  'utf8',
)

describe('AutomationView primary page hierarchy', () => {
  test('uses the shared primary page with Codex status navigation', () => {
    expect(viewSource).toContain('<PrimaryPageLayout')
    expect(viewSource).toContain('search={(')
    expect(viewSource).toContain("{ value: 'all', label: '全部' }")
    expect(viewSource).toContain("{ value: 'active', label: '已开启' }")
    expect(viewSource).toContain("{ value: 'paused', label: '已暂停' }")
    expect(viewSource).toContain("{ value: 'completed', label: '已完成' }")
    expect(viewSource).not.toContain("label: '计划任务'")
    expect(viewSource).not.toContain("label: '运行收件箱'")
    expect(viewSource).not.toContain('automation-header-meta')
    expect(viewSource).not.toContain('automation-workbench')
    expect(viewSource).not.toContain('安排第一项自动化')
    expect(viewSource).toContain('暂无已安排任务')
    expect(viewSource).toContain('创建任务后，它们会按状态显示在这里。')
    expect(viewSource).toContain('未找到已安排任务')
    expect(viewSource).toContain('<AutomationSuggestions')
    expect(viewSource).toContain("controller.filter === 'all'")
    expect(viewSource).toContain("controller.query.trim() === ''")
    expect(viewSource).toContain('controller.automations.length === 0')
    expect(viewSource).toContain('showInitialEmpty ? <AutomationEmptyState /> : null')
  })

  test('keeps run history in the detail panel and chat creation prefilled', () => {
    const detailSource = readFileSync(
      new URL('../src/features/automation/AutomationDetailPanel.tsx', import.meta.url),
      'utf8',
    )
    expect(detailSource).toContain('<RunHistory')
    expect(viewSource).toContain('composerDraftStore.prefillTextIfEmpty')
  })

  test('derives completed tasks without treating an active run as completed', () => {
    const automation = {
      id: 'automation-1',
      status: 'active',
      nextRunAt: null,
    } as Automation
    expect(isCompletedAutomation(automation, [])).toBe(true)
    expect(
      isCompletedAutomation(automation, [
        {
          automationId: automation.id,
          status: 'running',
        } as AutomationRun,
      ]),
    ).toBe(false)
    expect(
      isCompletedAutomation({ ...automation, status: 'paused' }, []),
    ).toBe(false)
  })

  test('keeps suggestion copy and created drafts on the same template source', () => {
    const weekly = AUTOMATION_TEMPLATES.find(item => item.id === 'weekly-review')
    expect(weekly?.schedule).toEqual({
      mode: 'weekly',
      weekdays: ['FR'],
      time: '16:00',
    })
    const draft = defaultAutomationDraft({
      projectId: 'project-1',
      model: { providerID: 'openai', id: 'gpt-5' },
      template: 'weekly-review',
    })
    expect(draft.name).toBe(weekly?.name)
    expect(draft.prompt).toBe(weekly?.prompt)
    expect(draft.schedule).toEqual(weekly?.schedule)
  })

  test('keeps the original spacious suggestion rhythm', () => {
    expect(styleSource).toContain(
      'padding: var(--cpx-sys-space-3) var(--cpx-sys-space-2);',
    )
    expect(styleSource).toContain('gap: var(--cpx-sys-space-3);')
    expect(styleSource).toContain('font: var(--cpx-sys-type-body-sm);')
    const sectionStyles = styleSource.match(
      /\.automation-suggestions \{[\s\S]*?\n\}/,
    )?.[0]
    const headingStyles = styleSource.match(
      /\.automation-suggestions h2 \{[\s\S]*?\n\}/,
    )?.[0]

    expect(sectionStyles).toContain(
      'border-top: 1px solid var(--cpx-sys-color-border-subtle);',
    )
    expect(headingStyles).not.toContain('padding:')
    expect(headingStyles).not.toContain(
      'border-bottom: 1px solid var(--cpx-sys-color-border-subtle);',
    )
  })
})
