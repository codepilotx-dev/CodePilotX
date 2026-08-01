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
  buildSidebarPinnedItems,
  buildProjectSessionBuckets,
  buildSidebarViewModel,
  deriveSidebarSessionVisualState,
  reorderSidebarPinnedItemKeys,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
  sidebarProjectKey,
  sortProjectsForSidebar,
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

  test('interleaves pinned tasks and projects with one cross-type manual order', () => {
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
      sidebarPinnedProjectKey(newerProject),
      sidebarPinnedSessionKey(pinnedSession),
      sidebarPinnedProjectKey(olderProject),
    ])

    const manuallyOrdered = buildSidebarPinnedItems({
      pinnedSessions: [pinnedSession],
      pinnedWorkspaces: [olderProject, newerProject],
      storedOrder: [
        sidebarPinnedProjectKey(olderProject),
        sidebarPinnedSessionKey(pinnedSession),
        sidebarPinnedProjectKey(newerProject),
      ],
    })
    expect(manuallyOrdered.map(item => item.key)).toEqual([
      sidebarPinnedProjectKey(olderProject),
      sidebarPinnedSessionKey(pinnedSession),
      sidebarPinnedProjectKey(newerProject),
    ])
    expect(
      reorderSidebarPinnedItemKeys(
        manuallyOrdered,
        sidebarPinnedProjectKey(olderProject),
        sidebarPinnedSessionKey(pinnedSession),
      ),
    ).toEqual([
      sidebarPinnedSessionKey(pinnedSession),
      sidebarPinnedProjectKey(olderProject),
      sidebarPinnedProjectKey(newerProject),
    ])
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
