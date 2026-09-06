import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarSessionGroup } from '../src/features/layout/sidebar/SidebarSessionGroup.js'
import { SidebarHoverCardProvider } from '../src/features/layout/sidebar/SidebarHoverCard.js'
import { DesktopSettingsProvider } from '../src/features/settings/useDesktopSettings.js'
import { mockSessionSnapshot, mockWorkspace } from '../src/services/desktop-client/fixtures.js'
import type { SessionListItem } from '../src/uiTypes.js'

test('sidebar approval replaces the spinner until the session resumes running', () => {
  const project = mockWorkspace('C:\\sidebar-status')
  const base = mockSessionSnapshot('status', project, { workspacePath: project.path }).item
  const render = (status: SessionListItem['status'], pending = false, latestTurnStatus: SessionListItem['latestTurnStatus'] = null) => renderToStaticMarkup(
    <DesktopSettingsProvider access="read-only">
      <SidebarHoverCardProvider>
        <SidebarSessionGroup
          activeSessionId={null} groupKey="status" now={0}
          sessions={[{ ...base, status, latestTurnStatus, planModeActive: true, unreadAt: null }]}
          pendingPermissionSessionIds={new Set(pending ? [base.id] : [])}
          titleLoadingIds={new Set()} sessionFallbackTitles={{}}
          onArchiveSessions={async () => true} onPinSession={() => {}}
          onSelectSession={() => {}} onToggleSessionUnread={() => {}}
          onRenameSession={async () => true} onUnpinSession={() => {}}
        />
      </SidebarHoverCardProvider>
    </DesktopSettingsProvider>,
  )
  for (const approval of [render('waiting'), render('running', true)]) {
    expect(approval).toContain('sidebar-session-approval')
    expect(approval).not.toContain('sidebar-session-spinner')
    expect(approval).not.toContain('class="sidebar-indicator"')
  }
  const running = render('running')
  expect(running).toContain('sidebar-session-spinner')
  expect(running).not.toContain('sidebar-session-approval')
  const question = render('waiting', true, 'waiting-question')
  expect(question).toContain('需要用户输入')
  expect(question).not.toContain('等待审批')
  expect(question).not.toContain('sidebar-session-spinner')
  const permission = render('waiting', true, 'waiting-permission')
  expect(permission).toContain('等待审批')
  expect(permission).not.toContain('需要用户输入')
})
