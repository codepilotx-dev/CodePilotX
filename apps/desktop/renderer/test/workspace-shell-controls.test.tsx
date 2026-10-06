import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BottomPanelToggleIcon,
  RightPanelToggleIcon,
  WorkspaceShellControls,
  resolveWorkspaceControlPresentation,
} from '../src/features/layout/dock/WorkspaceShellControls.js'

function renderControls(
  overrides: Partial<Parameters<typeof WorkspaceShellControls>[0]> = {},
): string {
  return renderToStaticMarkup(
    <WorkspaceShellControls
      canCreateWorkspaceTab={true}
      createWorkspaceTabReason="当前桌面运行环境没有提供内置浏览器能力。"
      hasWorkspaceTabs={false}
      onCreateWorkspaceTab={() => {}}
      onStepWorkspaceLayout={() => {}}
      onToggleTerminal={() => {}}
      showBottomPanel={true}
      showRightPanel={true}
      terminalAvailable={true}
      terminalVisible={false}
      workspaceLayout="chat"
      {...overrides}
    />,
  )
}

describe('WorkspaceShellControls', () => {
  test('renders divider and both bottom panel and right panel controls', () => {
    const html = renderControls()

    expect(html).toContain('workspace-shell-controls')
    expect(html).toContain('workspace-shell-controls__divider')
    expect(html).toContain('aria-label="打开底部面板 (Ctrl+`)"')
    expect(html).toContain('title="打开底部面板 (Ctrl+`)"')
    expect(html).toContain('aria-label="新建标签页 (Ctrl+Shift+B)"')
    expect(html).not.toContain('aria-label="进入完整视图"')
    expect(html).not.toContain('disabled=""')
  })

  test('disables the empty workspace entry when no tab can be created', () => {
    const html = renderControls({ canCreateWorkspaceTab: false })

    expect(html).toContain('title="当前桌面运行环境没有提供内置浏览器能力。"')
    expect(html).toContain('disabled=""')
  })

  test('keeps tab entries hidden while the workspace shows the chat surface', () => {
    const html = renderControls({ hasWorkspaceTabs: true, workspaceLayout: 'chat' })

    expect(html).toContain('aria-label="显示标签页 (Ctrl+Shift+B)"')
    expect(html).toContain('aria-pressed="false"')
  })

  test('split view only offers hiding tabs', () => {
    const html = renderControls({ hasWorkspaceTabs: true, workspaceLayout: 'split' })

    expect(html).toContain('aria-label="隐藏标签页 (Ctrl+Shift+B)"')
    expect(html).toContain('title="隐藏标签页 (Ctrl+Shift+B)"')
    expect(html).not.toContain('aria-label="进入完整视图"')
    expect(html).toContain('aria-pressed="true"')
  })

  test('presentation helper stays in sync with the observable layout', () => {
    expect(resolveWorkspaceControlPresentation('chat', false)).toEqual({
      label: '新建标签页',
      pressed: false,
    })
    expect(resolveWorkspaceControlPresentation('chat', true)).toEqual({
      label: '显示标签页',
      pressed: false,
    })
    expect(resolveWorkspaceControlPresentation('split', true)).toEqual({
      label: '隐藏标签页',
      pressed: true,
    })
  })

  test('disables bottom panel toggle when terminal is unavailable', () => {
    const html = renderControls({ terminalAvailable: false })

    expect(html).toContain('disabled=""')
    expect(html).toContain('title="创建任务后可使用底部面板"')
  })

  test('returns null when neither panel is shown', () => {
    const html = renderControls({ showBottomPanel: false, showRightPanel: false })

    expect(html).toBe('')
  })
})

describe('Panel toggle icons', () => {
  test('BottomPanelToggleIcon renders expected path for open and closed states', () => {
    const openHtml = renderToStaticMarkup(<BottomPanelToggleIcon open={true} />)
    expect(openHtml).toContain('lucide-panel-bottom')
    expect(openHtml).toContain('data-open="true"')
    expect(openHtml).toContain('M3 15h18')

    const closedHtml = renderToStaticMarkup(<BottomPanelToggleIcon open={false} />)
    expect(closedHtml).toContain('data-open="false"')
  })

  test('RightPanelToggleIcon renders expected path for open and closed states', () => {
    const openHtml = renderToStaticMarkup(<RightPanelToggleIcon open={true} />)
    expect(openHtml).toContain('lucide-panel-right')
    expect(openHtml).toContain('data-open="true"')
    expect(openHtml).toContain('M15 3v18')

    const closedHtml = renderToStaticMarkup(<RightPanelToggleIcon open={false} />)
    expect(closedHtml).toContain('data-open="false"')
  })
})
