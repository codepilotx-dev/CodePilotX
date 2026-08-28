import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AutomationView } from '../src/features/automation/AutomationView.js'
import { WorkspaceHeaderProvider } from '../src/features/layout/workspace-header/index.js'

describe('AutomationView', () => {
  test('renders the scheduled task search, status tabs, empty state, and suggestions', () => {
    const html = renderToStaticMarkup(
      <WorkspaceHeaderProvider routeScope="/automations">
        <AutomationView />
      </WorkspaceHeaderProvider>,
    )

    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('已安排的任务')
    expect(html).toContain('placeholder="搜索已安排任务"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('全部')
    expect(html).toContain('已开启')
    expect(html).toContain('已暂停')
    expect(html).toContain('已完成')
    expect(html).toContain('暂无已安排任务')
    expect(html).toContain('automation-suggestions')
    expect(html).not.toContain('automation-canvas')
  })
})
