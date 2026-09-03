import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BottomPanelToggleIcon,
  RightPanelToggleIcon,
  WorkspaceShellControls,
} from '../src/features/layout/dock/WorkspaceShellControls.js'
import type { WorkbenchPanelSnapshot } from '../src/features/layout/dock/rightDockState.js'

const baseDockState: WorkbenchPanelSnapshot = {
  activeTab: 'review',
  availableTabs: ['review'],
  badges: {},
  open: false,
  tabs: [{ id: 'review', kind: 'review' }],
}

describe('WorkspaceShellControls', () => {
  test('renders divider and both bottom panel and right panel controls', () => {
    const html = renderToStaticMarkup(
      <WorkspaceShellControls
        onToggleRightPanel={() => {}}
        onToggleTerminal={() => {}}
        rightDockState={baseDockState}
        showBottomPanel={true}
        showRightPanel={true}
        terminalAvailable={true}
        terminalVisible={false}
      />,
    )

    expect(html).toContain('workspace-shell-controls')
    expect(html).toContain('workspace-shell-controls__divider')
    expect(html).toContain('aria-label="打开底部面板 (Ctrl+`)"')
    expect(html).toContain('title="打开底部面板 (Ctrl+`)"')
    expect(html).toContain('aria-label="显示右侧面板"')
  })

  test('switches labels and pressed state when bottom panel and right panel are open', () => {
    const html = renderToStaticMarkup(
      <WorkspaceShellControls
        onToggleRightPanel={() => {}}
        onToggleTerminal={() => {}}
        rightDockState={{ ...baseDockState, open: true }}
        showBottomPanel={true}
        showRightPanel={true}
        terminalAvailable={true}
        terminalVisible={true}
      />,
    )

    expect(html).toContain('aria-label="隐藏底部面板"')
    expect(html).toContain('title="隐藏底部面板"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="关闭右侧面板"')
    expect(html).toContain('title="关闭右侧面板"')
  })

  test('disables bottom panel toggle when terminal is unavailable', () => {
    const html = renderToStaticMarkup(
      <WorkspaceShellControls
        onToggleRightPanel={() => {}}
        onToggleTerminal={() => {}}
        rightDockState={baseDockState}
        showBottomPanel={true}
        showRightPanel={true}
        terminalAvailable={false}
        terminalVisible={false}
      />,
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('title="创建任务后可使用底部面板"')
  })

  test('returns null when neither panel is shown', () => {
    const html = renderToStaticMarkup(
      <WorkspaceShellControls
        onToggleRightPanel={() => {}}
        onToggleTerminal={() => {}}
        rightDockState={baseDockState}
        showBottomPanel={false}
        showRightPanel={false}
        terminalAvailable={true}
        terminalVisible={false}
      />,
    )

    expect(html).toBe('')
  })
})

describe('Panel toggle icons', () => {
  test('BottomPanelToggleIcon renders expected path for open and closed states', () => {
    const openHtml = renderToStaticMarkup(<BottomPanelToggleIcon open={true} />)
    expect(openHtml).toContain('M2.5 12.5h15')

    const closedHtml = renderToStaticMarkup(<BottomPanelToggleIcon open={false} />)
    expect(closedHtml).toContain('M7 12.5h6')
  })

  test('RightPanelToggleIcon renders expected path for open and closed states', () => {
    const openHtml = renderToStaticMarkup(<RightPanelToggleIcon open={true} />)
    expect(openHtml).toContain('M12.25 3.5v13')

    const closedHtml = renderToStaticMarkup(<RightPanelToggleIcon open={false} />)
    expect(closedHtml).toContain('M12.9 7v6')
  })
})
