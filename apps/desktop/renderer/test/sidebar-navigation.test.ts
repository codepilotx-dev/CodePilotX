import { describe, expect, test } from 'bun:test'
import type {
  DesktopRemovedWorkspace,
  DesktopWorkspace,
} from '../shared/types.js'
import type { SessionListItem } from '../src/uiTypes.js'
import {
  deriveSidebarShellMode,
  isSidebarEdgeHit,
  isSidebarNarrow,
  isSidebarPanelHit,
  isSidebarTriggerHoverReady,
  resolveSidebarEscapeAction,
  SIDEBAR_EDGE_HIT_WIDTH,
  SIDEBAR_RESPONSIVE_BREAKPOINT,
  shouldShowSidebarPreview,
} from '../src/features/layout/sidebarShellState.js'
import {
  buildSidebarViewModel,
  deriveSidebarSessionVisualState,
} from '../src/features/layout/sidebar/sidebarViewModel.js'
import { sortSessionsForSidebar } from '../src/features/session/sessionSorting.js'

describe('sidebar shell modes', () => {
  test('uses the 720px container boundary without changing desktop preference', () => {
    expect(isSidebarNarrow(SIDEBAR_RESPONSIVE_BREAKPOINT)).toBe(true)
    expect(isSidebarNarrow(SIDEBAR_RESPONSIVE_BREAKPOINT + 1)).toBe(false)
    expect(
      deriveSidebarShellMode({
        desktopCollapsed: false,
        previewOpen: false,
        responsiveAutoHidden: true,
      }),
    ).toBe('collapsed')
    expect(
      deriveSidebarShellMode({
        desktopCollapsed: true,
        previewOpen: true,
        responsiveAutoHidden: false,
      }),
    ).toBe('preview')
    expect(
      deriveSidebarShellMode({
        desktopCollapsed: false,
        previewOpen: false,
        responsiveAutoHidden: false,
      }),
    ).toBe('docked')
    expect(
      deriveSidebarShellMode({
        desktopCollapsed: true,
        previewOpen: true,
        responsiveAutoHidden: false,
      }),
    ).toBe('preview')
  })

  test('opens at the 12px edge and keeps an open preview through its full width', () => {
    expect(isSidebarEdgeHit(-1)).toBe(false)
    expect(isSidebarEdgeHit(0)).toBe(true)
    expect(isSidebarEdgeHit(SIDEBAR_EDGE_HIT_WIDTH)).toBe(true)
    expect(isSidebarEdgeHit(SIDEBAR_EDGE_HIT_WIDTH + 0.01)).toBe(false)

    expect(isSidebarPanelHit(275, 275)).toBe(true)
    expect(isSidebarPanelHit(276, 275)).toBe(false)
    expect(
      shouldShowSidebarPreview({
        delayedTriggerHover: false,
        pointerX: 100,
        previewOpen: false,
        rearmBlocked: false,
        resizing: false,
        sidebarWidth: 275,
      }),
    ).toBe(false)
    expect(
      shouldShowSidebarPreview({
        delayedTriggerHover: false,
        pointerX: 100,
        previewOpen: true,
        rearmBlocked: false,
        resizing: false,
        sidebarWidth: 275,
      }),
    ).toBe(true)
  })

  test('honors trigger delay, rearm blocking, and floating resize', () => {
    expect(isSidebarTriggerHoverReady(99)).toBe(false)
    expect(isSidebarTriggerHoverReady(100)).toBe(true)
    const base = {
      delayedTriggerHover: false,
      pointerX: null,
      previewOpen: false,
      rearmBlocked: false,
      resizing: false,
      sidebarWidth: 275,
    }
    expect(
      shouldShowSidebarPreview({
        ...base,
        delayedTriggerHover: true,
      }),
    ).toBe(true)
    expect(
      shouldShowSidebarPreview({
        ...base,
        delayedTriggerHover: true,
        rearmBlocked: true,
      }),
    ).toBe(false)
    expect(
      shouldShowSidebarPreview({
        ...base,
        rearmBlocked: true,
        resizing: true,
      }),
    ).toBe(true)
  })

  test('prioritizes local handlers, transient panels, and settings return', () => {
    const base = {
      defaultPrevented: false,
      isDialogOpen: false,
      isSettingsRoute: true,
      isTextEntry: false,
    }
    expect(
      resolveSidebarEscapeAction({
        ...base,
        defaultPrevented: true,
        mode: 'preview',
      }),
    ).toBe('none')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        isTextEntry: true,
        mode: 'preview',
      }),
    ).toBe('none')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        isTextEntry: true,
        mode: 'docked',
      }),
    ).toBe('none')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        isDialogOpen: true,
        mode: 'docked',
      }),
    ).toBe('none')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        mode: 'docked',
      }),
    ).toBe('settings-back')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        isSettingsRoute: false,
        mode: 'docked',
      }),
    ).toBe('none')
  })
})

describe('sidebar view model', () => {
  const projects: DesktopWorkspace[] = [
    { name: 'Alpha', path: 'C:\\alpha' },
    { name: 'Removed', path: 'C:\\removed' },
  ]
  const removed: DesktopRemovedWorkspace[] = [
    {
      name: 'Removed',
      path: 'C:\\removed',
      removedAt: '2026-07-18T00:00:00.000Z',
    },
  ]
  const sessions = [
    session('pinned', 'C:\\alpha', '2026-07-18T04:00:00.000Z'),
    session('project', 'C:\\beta', '2026-07-18T05:00:00.000Z'),
    session('standalone', '', '2026-07-18T03:00:00.000Z', true),
    { ...session('archived', 'C:\\alpha'), archivedAt: '2026-07-18T06:00:00.000Z' },
  ]

  test('deduplicates pinned tasks and filters archived and removed entries', () => {
    const model = buildSidebarViewModel({
      pendingPermissionSessionIds: new Set(['project']),
      recentWorkspaces: projects,
      removedWorkspaces: removed,
      sessionPins: { pinned: '2026-07-18T07:00:00.000Z' },
      sessions,
    })
    expect(model.pinnedSessions.map(item => item.id)).toEqual(['pinned'])
    expect(model.unpinnedSessions.map(item => item.id)).toEqual([
      'project',
      'standalone',
    ])
    expect(model.projectWorkspaces.map(item => item.path)).toEqual([
      'C:\\beta',
      'C:\\alpha',
    ])
    expect(model.standaloneSessions.map(item => item.id)).toEqual(['standalone'])
    expect(model.sessionStateById.project).toBe('needs-input')
    expect(model.sessionStateById.archived).toBeUndefined()
  })

  test('derives stable visual state precedence', () => {
    expect(
      deriveSidebarSessionVisualState(
        { ...sessions[0]!, status: 'running', unreadAt: '2026-07-18T00:00:00Z' },
        new Set(['pinned']),
      ),
    ).toBe('needs-input')
    expect(
      deriveSidebarSessionVisualState(
        { ...sessions[0]!, status: 'running', unreadAt: '2026-07-18T00:00:00Z' },
        new Set(),
      ),
    ).toBe('running')
  })

  test('supports updated, created, priority, and manual sorting', () => {
    const createdFirst = session(
      'created-first',
      'C:\\alpha',
      '2026-07-18T01:00:00Z',
      false,
      '2026-07-18T06:00:00Z',
    )
    const updatedFirst = session(
      'updated-first',
      'C:\\alpha',
      '2026-07-18T06:00:00Z',
      false,
      '2026-07-18T01:00:00Z',
    )
    const options = {
      needsInputSessionIds: new Set<string>(),
      unreadSessionIds: new Set<string>(),
      manualOrderByScope: { test: ['created-first', 'updated-first'] },
      scopeKey: 'test',
    }
    expect(
      sortSessionsForSidebar([createdFirst, updatedFirst], {
        ...options,
        sort: 'updated',
      }).map(item => item.id),
    ).toEqual(['updated-first', 'created-first'])
    expect(
      sortSessionsForSidebar([createdFirst, updatedFirst], {
        ...options,
        sort: 'created',
      }).map(item => item.id),
    ).toEqual(['created-first', 'updated-first'])
    expect(
      sortSessionsForSidebar([updatedFirst, createdFirst], {
        ...options,
        sort: 'manual',
      }).map(item => item.id),
    ).toEqual(['created-first', 'updated-first'])
  })
})

function session(
  id: string,
  workspacePath: string,
  lastMessageAt = '2026-07-18T00:00:00.000Z',
  standalone = false,
  createdAt = '2026-07-18T00:00:00.000Z',
): SessionListItem {
  return {
    id,
    workspaceName: standalone ? '' : workspacePath.split('\\').at(-1) ?? '',
    workspacePath,
    standalone,
    createdAt,
    lastMessageAt,
    status: 'idle',
    archivedAt: null,
    pinnedAt: null,
    unreadAt: null,
  } as SessionListItem
}
