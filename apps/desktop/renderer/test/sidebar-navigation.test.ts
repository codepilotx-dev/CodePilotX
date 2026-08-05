import { describe, expect, test } from 'bun:test'
import type {
  DesktopRemovedWorkspace,
  DesktopWorkspace,
} from '../shared/types.js'
import {
  SESSION_TITLE_MAX_LENGTH,
  sessionDisplayTitle,
  sessionEditableTitle,
  sessionResolvedTitle,
  type SessionListItem,
} from '../src/uiTypes.js'
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
  buildSidebarSessionHoverCardModel,
  formatSidebarSessionRelativeTime,
} from '../src/features/layout/sidebar/SidebarSessionHoverCard.js'
import {
  countOpenProjectSessions,
} from '../src/features/layout/sidebar/SidebarProjectHoverCard.js'
import { getSidebarSessionDisplayGroups } from '../src/features/layout/sidebar/SidebarSessionGroup.js'
import {
  buildSidebarTimelineModel,
  buildSidebarPinnedItems,
  buildProjectSessionBuckets,
  buildSidebarViewModel,
  deriveSidebarSessionVisualState,
  labelForDayOffset,
  localDayOrdinal,
  reorderSidebarPinnedItemKeys,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
  sidebarProjectKey,
  sortProjectsForSidebar,
  type SidebarTimelineModel,
} from '../src/features/layout/sidebar/sidebarViewModel.js'
import { sortSessionsForSidebar } from '../src/features/session/state/sessionSorting.js'
import {
  getSidebarTopNavItems,
  SIDEBAR_PRODUCT_MODE_META,
  SIDEBAR_PRODUCT_MODE_ORDER,
  TOP_NAV_ITEMS,
} from '../src/features/layout/sidebar/SidebarTopNav.js'
import {
  SETTINGS_GROUPS,
  SETTINGS_ITEMS,
} from '../src/features/settings/settingsRegistry.js'

describe('Codex 侧栏导航', () => {
  test('产品模式按约定顺序展示名称和说明', () => {
    expect(
      SIDEBAR_PRODUCT_MODE_ORDER.map(value => ({
        value,
        ...SIDEBAR_PRODUCT_MODE_META[value],
      })),
    ).toEqual([
      { value: 'coding', label: 'Coding', description: '构建、调试并发布' },
      { value: 'working', label: 'Working', description: '写作、分析和协作' },
      { value: 'chat', label: 'Chat', description: '创建、学习和探索' },
    ])
  })

  test('按产品入口优先顺序展示且搜索只保留在侧栏头部', () => {
    expect(TOP_NAV_ITEMS.map(item => ({ view: item.view, label: item.label, path: item.path }))).toEqual([
      { view: 'new', label: '新建任务', path: '/new' },
      { view: 'pullRequests', label: '拉取请求', path: '/pull-requests' },
      { view: 'automations', label: '自动化', path: '/automations' },
      { view: 'plugins', label: '插件', path: '/plugins' },
      { view: 'models', label: '供应商', path: '/models' },
      { view: 'labs', label: 'Codex Labs', path: '/labs' },
    ])
    expect(TOP_NAV_ITEMS.some(item => item.path === '/search')).toBeFalse()
    expect(TOP_NAV_ITEMS.some(item => item.path === '/sites')).toBeFalse()
    expect(getSidebarTopNavItems(false)).toEqual(TOP_NAV_ITEMS)
    expect(
      getSidebarTopNavItems(true).map(item => ({
        view: item.view,
        label: item.label,
        path: item.path,
      })),
    ).toEqual([
      { view: 'new', label: '新建任务', path: '/new' },
      { view: 'projects', label: '项目', path: '/projects' },
      ...TOP_NAV_ITEMS.slice(1).map(item => ({
        view: item.view,
        label: item.label,
        path: item.path,
      })),
    ])
  })

  test('从设置目录移除旧 connections 标签', () => {
    expect(SETTINGS_ITEMS.some(item => item.routeId === 'connections')).toBeFalse()
  })

  test('使用统一插件页管理扩展并移除独立 MCP 设置入口', () => {
    const integrations = SETTINGS_GROUPS.find(
      group => group.id === 'integrations',
    )

    expect(integrations?.items.map(item => item.routeId)).toEqual([
      'plugins',
      'browser',
    ])
    expect(SETTINGS_ITEMS.some(item => item.routeId === 'mcp')).toBeFalse()
  })
})

describe('设置导航', () => {
  test('宠物设置保留商店入口但主侧栏不增加商店项', () => {
    const pets = SETTINGS_ITEMS.find(item => item.routeId === 'pets')

    expect(pets?.rows.some(row => row.title === '社区宠物商店')).toBeTrue()
    expect(TOP_NAV_ITEMS.some(item => item.path === '/pets')).toBeFalse()
  })

  test('工作空间依赖项是编码分组中的独立页面', () => {
    const codingGroup = SETTINGS_GROUPS.find(group => group.id === 'coding')
    const dependencies = SETTINGS_ITEMS.find(
      item => item.routeId === 'dependencies',
    )
    const config = SETTINGS_ITEMS.find(item => item.routeId === 'config')

    expect(codingGroup?.items.some(item => item.routeId === 'dependencies')).toBeTrue()
    expect(dependencies?.label).toBe('工作空间依赖项')
    expect(dependencies?.rows.map(row => row.title)).toEqual([
      'Node.js',
      'Python',
      'Git Bash',
      'ripgrep',
    ])
    expect(config?.rows.some(row => row.title === '工作空间依赖项')).toBeFalse()
  })
})

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
    expect(model.pinnedWorkspaces).toEqual([])
    expect(model.unpinnedSessions.map(item => item.id)).toEqual([
      'project',
      'standalone',
    ])
    expect(model.projectWorkspaces.map(item => item.path)).toEqual([
      'C:\\beta',
      'C:\\alpha',
    ])
    expect(model.standaloneSessions.map(item => item.id)).toEqual(['standalone'])
    expect(model.recentSessions.map(item => item.id)).toEqual(['standalone'])
    expect(model.sessionStateById.project).toBe('needs-input')
    expect(model.sessionStateById.archived).toBeUndefined()
  })

  test('groups project sessions once while keeping pinned tasks in aggregate counts', () => {
    const allSessions = [
      {
        ...session('pinned-running', 'C:\\alpha'),
        projectId: 'alpha',
        pinnedAt: '2026-07-18T08:00:00.000Z',
        status: 'running' as const,
        unreadAt: '2026-07-18T08:00:00.000Z',
      },
      {
        ...session('recent', 'C:\\alpha', '2026-07-18T07:00:00.000Z'),
        projectId: 'alpha',
      },
      {
        ...session('older', 'C:\\alpha', '2026-07-18T06:00:00.000Z'),
        projectId: 'alpha',
        status: 'waiting' as const,
      },
      session('standalone', '', '2026-07-18T09:00:00.000Z', true),
    ]
    const buckets = buildProjectSessionBuckets(
      allSessions.filter(item => !item.standalone),
      allSessions.filter(item => !item.pinnedAt),
    )
    const bucket = buckets.get('id:alpha')

    expect(bucket?.allSessions.map(item => item.id)).toEqual([
      'pinned-running',
      'recent',
      'older',
    ])
    expect(bucket?.displaySessions.map(item => item.id)).toEqual([
      'recent',
      'older',
    ])
    expect(bucket?.openCount).toBe(2)
    expect(bucket?.unreadCount).toBe(1)
    expect([...buckets.keys()]).not.toContain('path:')
  })

  test('shows pinned items in batches of twenty', () => {
    const items = Array.from({ length: 45 }, (_, index) => index)

    expect(getSidebarSessionDisplayGroups(items, 20, 20)).toMatchObject({
      baseSessions: items.slice(0, 20),
      extraSessions: [],
      canShowMore: true,
      canCollapse: false,
    })
    expect(getSidebarSessionDisplayGroups(items, 40, 20)).toMatchObject({
      baseSessions: items.slice(0, 20),
      extraSessions: items.slice(20, 40),
      canShowMore: true,
      canCollapse: true,
    })
  })

  test('flat organization projects every unpinned task into recent', () => {
    const model = buildSidebarViewModel({
      organization: 'flat',
      pendingPermissionSessionIds: new Set(),
      recentWorkspaces: projects,
      removedWorkspaces: removed,
      sessionPins: { pinned: '2026-07-18T07:00:00.000Z' },
      sessions,
    })

    expect(model.pinnedSessions.map(item => item.id)).toEqual(['pinned'])
    expect(model.recentSessions.map(item => item.id)).toEqual([
      'project',
      'standalone',
    ])
  })

  test('flat organization keeps pinned-project tasks only in the pinned group', () => {
    const model = buildSidebarViewModel({
      organization: 'flat',
      pendingPermissionSessionIds: new Set(),
      recentWorkspaces: [
        {
          name: 'Pinned',
          path: 'C:\\pinned',
          projectId: 'pinned-project',
          pinnedAt: '2026-07-18T08:00:00.000Z',
        },
        {
          name: 'Regular',
          path: 'C:\\regular',
          projectId: 'regular-project',
        },
      ],
      removedWorkspaces: [],
      sessionPins: {},
      sessions: [
        {
          ...session('pinned-project-task', 'C:\\pinned'),
          projectId: 'pinned-project',
        },
        {
          ...session('regular-project-task', 'C:\\regular'),
          projectId: 'regular-project',
        },
      ],
    })

    expect(model.pinnedWorkspaces.map(item => item.projectId)).toEqual([
      'pinned-project',
    ])
    expect(model.recentSessions.map(item => item.id)).toEqual([
      'regular-project-task',
    ])
  })

  test('pinned sessions always precede pinned projects regardless of pinnedAt', () => {
    const newerProject: DesktopWorkspace = {
      name: 'Newer project',
      path: 'C:\\newer',
      projectId: 'newer',
      pinnedAt: '2026-07-18T08:00:00.000Z',
    }
    const olderProject: DesktopWorkspace = {
      name: 'Older project',
      path: 'C:\\older',
      projectId: 'older',
      pinnedAt: '2026-07-18T06:00:00.000Z',
    }
    const pinnedSession = {
      ...session('middle-session', 'C:\\alpha'),
      pinnedAt: '2026-07-18T07:00:00.000Z',
    }
    const byPinnedAt = buildSidebarPinnedItems({
      pinnedSessions: [pinnedSession],
      pinnedWorkspaces: [olderProject, newerProject],
      storedOrder: [],
    })

    expect(byPinnedAt.map(item => item.key)).toEqual([
      sidebarPinnedSessionKey(pinnedSession),
      sidebarPinnedProjectKey(newerProject),
      sidebarPinnedProjectKey(olderProject),
    ])
  })

  test('normalizes mixed cross-type stored order into sessions then projects', () => {
    // 旧顺序：文件夹 B、会话 A、文件夹 C、会话 D
    // 新顺序：会话 A、会话 D、文件夹 B、文件夹 C（各组内部相对顺序不变）
    const projectB: DesktopWorkspace = {
      name: 'B',
      path: 'C:\\b',
      projectId: 'b',
      pinnedAt: '2026-07-18T06:00:00.000Z',
    }
    const projectC: DesktopWorkspace = {
      name: 'C',
      path: 'C:\\c',
      projectId: 'c',
      pinnedAt: '2026-07-18T08:00:00.000Z',
    }
    const sessionA = {
      ...session('a', 'C:\\alpha'),
      pinnedAt: '2026-07-18T05:00:00.000Z',
    }
    const sessionD = {
      ...session('d', 'C:\\delta'),
      pinnedAt: '2026-07-18T07:00:00.000Z',
    }
    const items = buildSidebarPinnedItems({
      pinnedSessions: [sessionA, sessionD],
      pinnedWorkspaces: [projectB, projectC],
      storedOrder: [
        sidebarPinnedProjectKey(projectB),
        sidebarPinnedSessionKey(sessionA),
        sidebarPinnedProjectKey(projectC),
        sidebarPinnedSessionKey(sessionD),
      ],
    })

    expect(items.map(item => item.key)).toEqual([
      sidebarPinnedSessionKey(sessionA),
      sidebarPinnedSessionKey(sessionD),
      sidebarPinnedProjectKey(projectB),
      sidebarPinnedProjectKey(projectC),
    ])
  })

  test('reorders pinned items within the same kind and rejects cross-kind moves', () => {
    const projectB: DesktopWorkspace = {
      name: 'B',
      path: 'C:\\b',
      projectId: 'b',
      pinnedAt: '2026-07-18T06:00:00.000Z',
    }
    const projectC: DesktopWorkspace = {
      name: 'C',
      path: 'C:\\c',
      projectId: 'c',
      pinnedAt: '2026-07-18T08:00:00.000Z',
    }
    const sessionA = {
      ...session('a', 'C:\\alpha'),
      pinnedAt: '2026-07-18T05:00:00.000Z',
    }
    const items = buildSidebarPinnedItems({
      pinnedSessions: [sessionA],
      pinnedWorkspaces: [projectB, projectC],
      storedOrder: [],
    })

    expect(
      reorderSidebarPinnedItemKeys(
        items,
        sidebarPinnedProjectKey(projectB),
        sidebarPinnedProjectKey(projectC),
      ),
    ).toEqual([
      sidebarPinnedSessionKey(sessionA),
      sidebarPinnedProjectKey(projectB),
      sidebarPinnedProjectKey(projectC),
    ])
    expect(
      reorderSidebarPinnedItemKeys(
        items,
        sidebarPinnedSessionKey(sessionA),
        sidebarPinnedProjectKey(projectC),
      ),
    ).toBeNull()
    expect(
      reorderSidebarPinnedItemKeys(
        items,
        sidebarPinnedProjectKey(projectC),
        sidebarPinnedSessionKey(sessionA),
      ),
    ).toBeNull()
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
    ).toBe('unread')
  })

  test('supports updated, priority, and manual task sorting', () => {
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
      sortSessionsForSidebar([updatedFirst, createdFirst], {
        ...options,
        sort: 'manual',
      }).map(item => item.id),
    ).toEqual(['created-first', 'updated-first'])
    expect(
      sortSessionsForSidebar([
        createdFirst,
        updatedFirst,
        session(
          'new-unordered',
          'C:\\alpha',
          '2026-07-18T07:00:00Z',
        ),
      ], {
        ...options,
        sort: 'manual',
      }).map(item => item.id),
    ).toEqual(['new-unordered', 'created-first', 'updated-first'])
    expect(
      sortSessionsForSidebar([
        session('new-a', 'C:\\alpha', '2026-07-18T08:00:00Z'),
        createdFirst,
        session('new-b', 'C:\\alpha', '2026-07-18T05:00:00Z'),
        updatedFirst,
      ], {
        ...options,
        sort: 'manual',
      }).map(item => item.id),
    ).toEqual(['new-a', 'created-first', 'new-b', 'updated-first'])
    expect(
      sortSessionsForSidebar([
        { ...createdFirst, id: 'idle' },
        { ...createdFirst, id: 'running', status: 'running' },
        {
          ...createdFirst,
          id: 'unread',
          unreadAt: '2026-07-18T07:00:00Z',
        },
        { ...createdFirst, id: 'waiting', status: 'waiting' },
      ], {
        ...options,
        sort: 'priority',
        unreadSessionIds: new Set(['unread']),
      }).map(item => item.id),
    ).toEqual(['waiting', 'unread', 'running', 'idle'])
  })

  test('sorts projects by activity before applying stable stored order', () => {
    const sortableProjects: DesktopWorkspace[] = [
      { name: 'Alpha', path: 'C:\\alpha', projectId: 'alpha' },
      { name: 'Beta', path: 'C:\\beta', projectId: 'beta' },
    ]
    const sortableSessions = [
      session('alpha-session', 'C:\\alpha', '2026-07-18T01:00:00Z'),
      {
        ...session('beta-session', 'C:\\beta', '2026-07-18T02:00:00Z'),
        projectId: 'beta',
      },
    ].map(item =>
      item.id === 'alpha-session' ? { ...item, projectId: 'alpha' } : item,
    )
    const options = {
      manualOrderByScope: {
        projects: [
          sidebarProjectKey(sortableProjects[0]!),
          sidebarProjectKey(sortableProjects[1]!),
        ],
      },
      scopeKey: 'projects',
      sessions: sortableSessions,
    }

    expect(
      sortProjectsForSidebar(sortableProjects, {
        ...options,
        manualOrderByScope: {},
      }).map(project => project.projectId),
    ).toEqual(['beta', 'alpha'])
    expect(
      sortProjectsForSidebar(sortableProjects, options).map(
        project => project.projectId,
      ),
    ).toEqual(['alpha', 'beta'])
    expect(
      sortProjectsForSidebar([
        ...sortableProjects,
        { name: 'Gamma', path: 'C:\\gamma', projectId: 'gamma' },
      ], {
        ...options,
      }).map(project => project.projectId),
    ).toEqual(['gamma', 'alpha', 'beta'])
  })
})

describe('sidebar session hover card projection', () => {
  test('shows compact time, project, and normalized work branch', () => {
    const item = {
      ...session('thread-1', 'F:\\CodeProject\\CodePilotX'),
      sessionName: '实现 Hover Card',
      gitBranch: '  codex/hover-card  ',
    }
    expect(buildSidebarSessionHoverCardModel(
      item,
      undefined,
      new Date('2026-07-18T00:19:00.000Z').getTime(),
    )).toEqual({
      title: '实现 Hover Card',
      relativeTime: '19 分',
      projectLabel: 'CodePilotX',
      gitBranch: 'codex/hover-card',
      unread: false,
    })
  })

  test('悬浮卡携带未读状态并按活动任务统计已开启数量', () => {
    const unreadItem = {
      ...session('thread-unread', 'F:\\CodeProject\\CodePilotX'),
      unreadAt: '2026-07-18T00:18:00.000Z',
    }
    expect(buildSidebarSessionHoverCardModel(
      unreadItem,
      undefined,
      new Date('2026-07-18T00:19:00.000Z').getTime(),
    ).unread).toBe(true)
    expect(countOpenProjectSessions([
      { ...unreadItem, status: 'queued' },
      { ...unreadItem, id: 'waiting', status: 'waiting' },
      { ...unreadItem, id: 'running', status: 'running' },
      { ...unreadItem, id: 'idle', status: 'idle' },
    ])).toBe(3)
  })

  test('统一解析完整标题并将展示标题限制为 20 个 Unicode 字符', () => {
    const persistedTitle = '😀'.repeat(21)
    const item = {
      ...session('thread-title', 'F:\\CodeProject\\CodePilotX'),
      sessionName: persistedTitle,
      aiTitle: null,
      firstPrompt: '临时首条消息',
    }

    expect(sessionResolvedTitle(item, '当前会话回退标题')).toBe(persistedTitle)
    expect(sessionEditableTitle(item, '当前会话回退标题')).toBe(persistedTitle)

    const displayTitle = sessionDisplayTitle(item, '当前会话回退标题')
    expect(displayTitle).toBe(`${'😀'.repeat(19)}…`)
    expect(Array.from(displayTitle)).toHaveLength(SESSION_TITLE_MAX_LENGTH)
    expect(sessionDisplayTitle(null, `# ${persistedTitle}`)).toBe(
      `# ${'😀'.repeat(17)}…`,
    )
  })

  test('优先显示用户和 AI 标题，并保留展示标题中的 Markdown', () => {
    const item = {
      ...session('thread-priority', 'F:\\CodeProject\\CodePilotX'),
      customTitle: null,
      aiTitle: '## AI 生成标题',
      sessionName: '数据库标题',
      firstPrompt: '首条消息',
    }

    expect(sessionDisplayTitle(item, '当前会话回退标题')).toBe('## AI 生成标题')
    expect(sessionDisplayTitle({
      ...item,
      customTitle: '> # 用户标题',
    }, '当前会话回退标题')).toBe('> # 用户标题')
    expect(sessionResolvedTitle({
      ...item,
      aiTitle: null,
      sessionName: '新对话',
    }, '当前会话回退标题')).toBe('当前会话回退标题')
  })

  test('项目环境是编码分组中的独立设置入口', () => {
    const codingGroup = SETTINGS_GROUPS.find(group => group.id === 'coding')
    const environment = SETTINGS_ITEMS.find(
      item => item.routeId === 'environment',
    )

    expect(codingGroup?.items.some(item => item.routeId === 'environment')).toBe(
      true,
    )
    expect(environment).toMatchObject({
      id: 'environment',
      label: '环境',
    })
  })

  test('groups projects by stable project id even when folders share a path', () => {
    const sharedPath = 'C:\\shared'
    const model = buildSidebarViewModel({
      pendingPermissionSessionIds: new Set(),
      recentWorkspaces: [
        { name: 'One', path: sharedPath, projectId: 'project-one' },
        { name: 'Two', path: sharedPath, projectId: 'project-two' },
      ],
      removedWorkspaces: [],
      sessionPins: {},
      sessions: [
        { ...session('one', sharedPath), projectId: 'project-one' },
        { ...session('two', sharedPath), projectId: 'project-two' },
      ],
    })

    expect(model.projectWorkspaces.map(item => item.projectId).sort()).toEqual([
      'project-one',
      'project-two',
    ])
  })

  test('pins projects independently by stable project id', () => {
    const sharedPath = 'C:\\shared'
    const model = buildSidebarViewModel({
      pendingPermissionSessionIds: new Set(),
      recentWorkspaces: [
        {
          name: 'Pinned',
          path: sharedPath,
          projectId: 'project-pinned',
          pinnedAt: '2026-07-18T08:00:00.000Z',
        },
        {
          name: 'Regular',
          path: sharedPath,
          projectId: 'project-regular',
          pinnedAt: null,
        },
      ],
      removedWorkspaces: [],
      sessionPins: {},
      sessions: [],
    })

    expect(model.pinnedWorkspaces.map(item => item.projectId)).toEqual([
      'project-pinned',
    ])
    expect(model.projectWorkspaces.map(item => item.projectId)).toEqual([
      'project-regular',
    ])
  })

  test('uses 会话 for standalone items and hides an empty branch', () => {
    const item = {
      ...session('thread-2', 'C:\\workspace', undefined, true),
      gitBranch: ' ',
    }
    const model = buildSidebarSessionHoverCardModel(
      item,
      '无项目会话',
      new Date('2026-07-18T03:00:00.000Z').getTime(),
    )
    expect(model.projectLabel).toBe('会话')
    expect(model.gitBranch).toBeNull()
    expect(formatSidebarSessionRelativeTime(
      '2026-07-16T03:00:00.000Z',
      new Date('2026-07-18T03:00:00.000Z').getTime(),
    )).toBe('2 天')
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

describe('侧栏时间线投影', () => {
  // 假定当前日期 2026-08-01（星期六）
  const NOW = new Date('2026-08-01T12:00:00.000Z').getTime()

  function timelineSession(
    id: string,
    latestTurnStatus: SessionListItem['latestTurnStatus'],
    lastMessageAt: string | null = '2026-08-01T00:00:00.000Z',
    extras: Partial<SessionListItem> = {},
  ): SessionListItem {
    return {
      ...session(id, `C:\\${id}`, lastMessageAt ?? undefined),
      latestTurnStatus,
      unreadAt: null,
      ...extras,
    }
  }

  function focus(
    sessions: SessionListItem[],
    priorityEnabled = true,
  ): SidebarTimelineModel {
    return buildSidebarTimelineModel({
      now: NOW,
      priorityEnabled,
      sessions,
    })
  }

  test('等待问题、等待权限、计划待审批、完成未读进入优先区，且不受日期窗口限制', () => {
    const model = focus([
      timelineSession('plan-approval', 'completed', '2026-05-01T00:00:00.000Z', {
        pendingPlanApproval: true,
      }),
      timelineSession('question', 'waiting-question', '2026-05-02T00:00:00.000Z'),
      timelineSession('permission', 'waiting-permission', '2026-05-03T00:00:00.000Z'),
      timelineSession('completed-unread', 'completed', '2026-05-04T00:00:00.000Z', {
        unreadAt: '2026-08-01T00:00:00.000Z',
      }),
    ])
    expect(model.prioritySessions.map(s => s.id)).toEqual([
      'permission',
      'question',
      'plan-approval',
      'completed-unread',
    ])
    expect(model.dateSections).toEqual([])
  })

  test('waiting-subagents、普通运行中和已读完成任务不进入优先区', () => {
    const model = focus([
      timelineSession('subagents', 'waiting-subagents'),
      timelineSession('running', 'running'),
      timelineSession('read-completed', 'completed'),
      timelineSession('queued', 'queued'),
    ])
    expect(model.prioritySessions).toEqual([])
    expect(model.dateSections.map(s => s.id)).toEqual(['day-0'])
    expect(
      model.dateSections[0]!.sessions.map(s => s.id).sort(),
    ).toEqual(['queued', 'read-completed', 'running', 'subagents'])
  })

  test('同一优先级内按最近活动时间倒序，再以任务 ID 保证稳定顺序', () => {
    const model = focus([
      timelineSession('older-question', 'waiting-question', '2026-08-01T01:00:00.000Z'),
      timelineSession('newer-question', 'waiting-question', '2026-08-01T12:00:00.000Z'),
    ])
    expect(model.prioritySessions.map(s => s.id)).toEqual([
      'newer-question',
      'older-question',
    ])
  })

  test('优先级任务不会在日期组重复出现', () => {
    const model = focus([
      timelineSession('question', 'waiting-question', '2026-08-01T00:00:00.000Z'),
      timelineSession('normal', 'idle', '2026-08-01T00:00:00.000Z'),
    ])
    expect(model.prioritySessions.map(s => s.id)).toEqual(['question'])
    expect(model.dateSections.map(s => s.id)).toEqual(['day-0'])
    expect(model.dateSections[0]!.sessions.map(s => s.id)).toEqual(['normal'])
  })

  test('清除未读后退出优先区，并在符合 7 天条件时回到日期区', () => {
    const unread = timelineSession('done', 'completed', '2026-08-01T00:00:00.000Z', {
      unreadAt: '2026-08-01T00:00:00.000Z',
    })
    const unreadModel = focus([unread])
    expect(unreadModel.prioritySessions.map(s => s.id)).toEqual(['done'])

    const readModel = focus([
      { ...unread, unreadAt: null },
    ])
    expect(readModel.prioritySessions).toEqual([])
    expect(readModel.dateSections.map(s => s.id)).toEqual(['day-0'])
    expect(readModel.dateSections[0]!.sessions.map(s => s.id)).toEqual(['done'])
  })

  test('7 天以前的等待用户任务仍进入优先区', () => {
    const model = focus([
      timelineSession('old-question', 'waiting-question', '2026-04-01T00:00:00.000Z'),
    ])
    expect(model.prioritySessions.map(s => s.id)).toEqual(['old-question'])
    expect(model.dateSections).toEqual([])
  })

  test('优先级未勾选时只显示最近 7 天，不提取优先任务', () => {
    const model = focus(
      [
        timelineSession('question', 'waiting-question', '2026-08-01T00:00:00.000Z'),
        timelineSession('old-normal', 'idle', '2026-04-01T00:00:00.000Z'),
      ],
      false,
    )
    expect(model.prioritySessions).toEqual([])
    expect(model.dateSections.map(s => s.id)).toEqual(['day-0'])
    expect(model.dateSections[0]!.sessions.map(s => s.id)).toEqual(['question'])
  })

  test('今天和昨天标签正确', () => {
    const today = new Date('2026-08-01T10:00:00.000Z').getTime()
    const yesterday = new Date('2026-07-31T10:00:00.000Z').getTime()
    expect(labelForDayOffset(0, new Date(today))).toBe('今天')
    expect(labelForDayOffset(1, new Date(yesterday))).toBe('昨天')
  })

  test('假定星期六时偏移 2 至 6 分别得到星期四到星期日', () => {
    expect(labelForDayOffset(2, new Date('2026-07-30T00:00:00.000Z'))).toBe('星期四')
    expect(labelForDayOffset(3, new Date('2026-07-29T00:00:00.000Z'))).toBe('星期三')
    expect(labelForDayOffset(4, new Date('2026-07-28T00:00:00.000Z'))).toBe('星期二')
    expect(labelForDayOffset(5, new Date('2026-07-27T00:00:00.000Z'))).toBe('星期一')
    expect(labelForDayOffset(6, new Date('2026-07-26T00:00:00.000Z'))).toBe('星期日')
  })

  test('没有任务的星期二不会生成空分组，日期组按偏移 0→6 排列', () => {
    const model = focus([
      timelineSession('today', 'idle', '2026-08-01T00:00:00.000Z'),
      timelineSession('thu', 'idle', '2026-07-30T00:00:00.000Z'),
      timelineSession('wed', 'idle', '2026-07-29T00:00:00.000Z'),
      timelineSession('mon', 'idle', '2026-07-27T00:00:00.000Z'),
      timelineSession('sun', 'idle', '2026-07-26T00:00:00.000Z'),
      timelineSession('fri', 'idle', '2026-07-31T00:00:00.000Z'),
    ])
    expect(model.dateSections.map(s => s.id)).toEqual([
      'day-0',
      'day-1',
      'day-2',
      'day-3',
      'day-5',
      'day-6',
    ])
    expect(model.dateSections.map(s => s.label)).toEqual([
      '今天',
      '昨天',
      '星期四',
      '星期三',
      '星期一',
      '星期日',
    ])
  })

  test('第 6 天任务仍显示，第 7 天及更早任务被隐藏', () => {
    const model = focus([
      timelineSession('day6', 'idle', '2026-07-26T00:00:00.000Z'),
      timelineSession('day7', 'idle', '2026-07-25T00:00:00.000Z'),
    ])
    expect(model.dateSections.flatMap(s => s.sessions).map(s => s.id)).toEqual([
      'day6',
    ])
  })

  test('跨月和跨年时仍按自然日分组', () => {
    // 当前为 2026-08-01，前 6 天跨越 7 月；再测一个跨年场景
    const model = focus([
      timelineSession('end-july', 'idle', '2026-07-26T23:00:00.000Z'),
    ])
    expect(model.dateSections[0]!.id).toBe('day-6')
    // 跨年：当前 2026-01-01，前 6 天跨越 2025
    const nyeModel = buildSidebarTimelineModel({
      now: new Date('2026-01-01T12:00:00.000Z').getTime(),
      priorityEnabled: false,
      sessions: [
        timelineSession('old-year', 'idle', '2025-12-30T00:00:00.000Z'),
      ],
    })
    expect(nyeModel.dateSections[0]!.id).toBe('day-2')
  })

  test('日期组内按最近活动时间倒序', () => {
    const model = focus([
      timelineSession('older', 'idle', '2026-08-01T01:00:00.000Z'),
      timelineSession('newer', 'idle', '2026-08-01T12:00:00.000Z'),
    ])
    expect(model.dateSections[0]!.sessions.map(s => s.id)).toEqual([
      'newer',
      'older',
    ])
  })

  test('无效时间的普通任务被隐藏，但无效时间的等待用户任务在优先模式下仍显示', () => {
    const model = focus([
      timelineSession('bad-normal', 'idle', '__bad__', {
        createdAt: '__invalid__',
      }),
      timelineSession('bad-priority', 'waiting-question', '__bad__', {
        createdAt: '__invalid__',
      }),
    ])
    expect(model.prioritySessions.map(s => s.id)).toEqual(['bad-priority'])
    expect(model.dateSections).toEqual([])
  })

  test('所有分组为空时返回空投影', () => {
    const model = focus([])
    expect(model.prioritySessions).toEqual([])
    expect(model.dateSections).toEqual([])
  })
})
