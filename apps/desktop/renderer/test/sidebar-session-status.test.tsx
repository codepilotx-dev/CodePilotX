import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarSessionGroup } from '../src/features/layout/sidebar/SidebarSessionGroup.js'
import { SidebarHoverCardProvider } from '../src/features/layout/sidebar/SidebarHoverCard.js'
import { DesktopSettingsProvider } from '../src/features/settings/useDesktopSettings.js'
import { mockSessionSnapshot, mockWorkspace } from '../src/services/desktop-client/fixtures.js'
import { withSessionStatusOverride } from '../src/services/desktop-client/sessionStatusOverrides.js'
import type { SessionListItem } from '../src/uiTypes.js'

function renderSessionRows(
  sessions: SessionListItem[],
  pendingPermissionSessionIds: ReadonlySet<string> = new Set(),
  sessionIndent: 'content' | 'gutter' = 'content',
) {
  return renderToStaticMarkup(
    <DesktopSettingsProvider access="read-only">
      <SidebarHoverCardProvider>
        <SidebarSessionGroup
          activeSessionId={null}
          groupKey="status"
          sessionIndent={sessionIndent}
          now={0}
          sessions={sessions}
          pendingPermissionSessionIds={pendingPermissionSessionIds}
          titleLoadingIds={new Set()}
          sessionFallbackTitles={{}}
          onArchiveSessions={async () => true}
          onPinSession={() => {}}
          onSelectSession={() => {}}
          onToggleSessionUnread={() => {}}
          onRenameSession={async () => true}
          onUnpinSession={() => {}}
        />
      </SidebarHoverCardProvider>
    </DesktopSettingsProvider>,
  )
}

const INDICATOR_CLASS_TOKEN = /(?:^|\s)sidebar-indicator(?=\s|$)/

test('gutter session rows and show-more omit the leading spacer', () => {
  const project = mockWorkspace('C:\\sidebar-gutter')
  const base = mockSessionSnapshot('gutter', project, { workspacePath: project.path }).item
  const sessions = Array.from({ length: 11 }, (_, index) => ({ ...base, id: `gutter-${index}` }))
  const markup = renderSessionRows(sessions, new Set(), 'gutter')
  expect(markup).toContain('sidebar-row--no-leading')
  expect(markup).toContain('展开显示')
  expect(markup).not.toContain('sidebar-row-leading-spacer')
  expect(markup).toContain('tw:grid-cols-[minmax(0,1fr)_auto]')
  expect(renderSessionRows(sessions)).toContain('sidebar-row-leading-spacer')
})

/** 统计带 `sidebar-indicator` 语义类的行尾状态槽数量（类名顺序无关）。 */
function countIndicatorSlots(markup: string): number {
  return [...markup.matchAll(/<span[^>]*class="([^"]*)"/g)].filter((match) =>
    INDICATOR_CLASS_TOKEN.test(match[1] ?? ''),
  ).length
}

test('sidebar approval replaces the spinner until the session resumes running', () => {
  const project = mockWorkspace('C:\\sidebar-status')
  const base = mockSessionSnapshot('status', project, { workspacePath: project.path }).item
  const render = (
    status: SessionListItem['status'],
    pending = false,
    latestTurnStatus: SessionListItem['latestTurnStatus'] = null,
  ) =>
    renderSessionRows(
      [{ ...base, status, latestTurnStatus, planModeActive: true, unreadAt: null }],
      new Set(pending ? [base.id] : []),
    )
  for (const approval of [render('waiting'), render('running', true)]) {
    expect(approval).toContain('sidebar-session-approval')
    expect(approval).not.toContain('sidebar-session-spinner')
    expect(countIndicatorSlots(approval)).toBe(0)
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

test('canonical completion clears a stale running indicator', () => {
  const project = mockWorkspace('C:\\sidebar-canonical')
  const base = mockSessionSnapshot('canonical', project, { workspacePath: project.path }).item
  const catalogSession = {
    ...base,
    status: 'running' as const,
    latestTurnStatus: 'running' as const,
    unreadAt: null,
  }

  // The catalog snapshot alone is what used to leave the row spinning forever.
  expect(renderSessionRows([catalogSession])).toContain('sidebar-session-spinner')

  // This is the status the session store publishes once the canonical projection
  // reports the terminal turn.
  const corrected = withSessionStatusOverride(catalogSession, {
    status: 'done',
    latestTurnStatus: 'completed',
  })
  const markup = renderSessionRows([corrected])
  expect(markup).not.toContain('sidebar-session-spinner')
  expect(countIndicatorSlots(markup)).toBe(0)
})

test('sidebar renders only occupied status icon slots in their existing order', () => {
  const project = mockWorkspace('C:\\sidebar-icons')
  const base = mockSessionSnapshot('icons', project, { workspacePath: project.path }).item
  for (const hasScheduledRun of [false, true]) {
    for (const isFork of [false, true]) {
      for (const state of ['idle', 'unread', 'running'] as const) {
        const markup = renderSessionRows([
          {
            ...base,
            hasScheduledRun,
            isFork,
            status: state === 'running' ? 'running' : 'done',
            unreadAt: state === 'unread' ? 1 : null,
          },
        ])
        const labels = [
          ...(hasScheduledRun ? ['日程运行过的会话'] : []),
          ...(isFork ? ['分叉会话'] : []),
          ...(state === 'unread' ? ['未读'] : state === 'running' ? ['加载中'] : []),
        ]
        expect(countIndicatorSlots(markup)).toBe(labels.length)
        expect(markup).not.toMatch(
          /<span[^>]*class="[^"]*sidebar-indicator[^"]*"[^>]*><\/span>/,
        )
        const positions = labels.map((label) => markup.indexOf(`aria-label="${label}"`))
        expect(positions.every((position) => position >= 0)).toBe(true)
        expect(positions).toEqual([...positions].sort((a, b) => a - b))
      }
    }
  }
})
