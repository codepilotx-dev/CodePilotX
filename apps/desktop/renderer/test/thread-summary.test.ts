import { describe, expect, test } from 'bun:test'

import {
  THREAD_SUMMARY_PANEL_WIDTH,
  THREAD_SUMMARY_PINNED_STORAGE_KEY,
  deriveThreadSummaryState,
  publishThreadSummaryPreference,
  readThreadSummaryPinnedPreference,
  resolveThreadSummaryDisplayMode,
  resolveThreadSummaryDisplayModeUpdate,
  resolveThreadSummaryShiftOffset,
  toggleThreadSummaryPreference,
  transitionThreadSummaryMode,
} from '../src/features/session/summary/threadSummaryState.js'
import {
  deriveThreadSummaryViewModel,
  findLatestThreadSummaryPlan,
  previewThreadSummarySources,
} from '../src/features/session/summary/threadSummaryViewModel.js'

describe('thread summary state', () => {
  test('resolves the exact responsive boundaries', () => {
    expect(THREAD_SUMMARY_PANEL_WIDTH).toBe(300)
    expect(resolveThreadSummaryDisplayMode(1095)).toBe('overlay')
    expect(resolveThreadSummaryDisplayMode(1096)).toBe('shift')
    expect(resolveThreadSummaryDisplayMode(1535)).toBe('shift')
    expect(resolveThreadSummaryDisplayMode(1536)).toBe('gutter')
    expect(resolveThreadSummaryDisplayMode(Number.NaN)).toBe('overlay')
  })

  test('resolves the shift offset according to display mode and pinning', () => {
    expect(resolveThreadSummaryShiftOffset({ displayMode: 'shift', isPinned: true })).toBe(-154)
    expect(resolveThreadSummaryShiftOffset({ displayMode: 'gutter', isPinned: true })).toBe(0)
    expect(resolveThreadSummaryShiftOffset({ displayMode: 'overlay', isPinned: true })).toBe(0)
    expect(resolveThreadSummaryShiftOffset({ displayMode: 'shift', isPinned: false })).toBe(0)
  })

  test('reserves inline space only for a pinned summary outside overlay mode', () => {
    const inlineState = deriveThreadSummaryState(1096, {
      isPinned: true,
      isPopoverOpen: false,
    })
    expect(inlineState).toMatchObject({
      displayMode: 'shift',
      shouldShowInline: true,
      shiftOffset: -154,
    })
    expect(inlineState).not.toHaveProperty('contentShift')

    expect(
      deriveThreadSummaryState(1536, {
        isPinned: true,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      displayMode: 'gutter',
      shouldShowInline: true,
      shiftOffset: 0,
    })
    expect(
      deriveThreadSummaryState(1096, {
        isPinned: false,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      shouldShowInline: false,
      shiftOffset: 0,
    })
    expect(
      deriveThreadSummaryState(1095, {
        isPinned: true,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      displayMode: 'overlay',
      shouldShowInline: false,
      shiftOffset: 0,
    })
  })

  test('updates React state only when a resize crosses a display mode boundary', () => {
    let mode = resolveThreadSummaryDisplayMode(700)
    let updates = 0
    for (let width = 701; width <= 1700; width += 1) {
      const nextMode = resolveThreadSummaryDisplayModeUpdate(mode, width)
      if (nextMode === null) continue
      mode = nextMode
      updates += 1
    }
    expect(updates).toBe(2)
    expect(mode).toBe('gutter')
  })

  test('toggles popover on narrow content and pinning on wide content', () => {
    const initial = { isPinned: true, isPopoverOpen: false }
    expect(toggleThreadSummaryPreference(initial, 'overlay')).toEqual({
      isPinned: true,
      isPopoverOpen: true,
    })
    expect(toggleThreadSummaryPreference(initial, 'shift')).toEqual({
      isPinned: false,
      isPopoverOpen: false,
    })
  })

  test('closes the popover when leaving overlay without resetting pinning', () => {
    const open = { isPinned: true, isPopoverOpen: true }
    expect(transitionThreadSummaryMode(open, 'overlay', 'shift')).toEqual({
      isPinned: true,
      isPopoverOpen: false,
    })
    expect(transitionThreadSummaryMode(open, 'overlay', 'overlay')).toBe(open)
  })

  test('persists only the pinning preference through its own UI key', () => {
    const stored = new Map<string, string>()
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => stored.set(key, value),
        },
      },
    })
    try {
      // 未写入过的用户读到默认置顶。
      expect(readThreadSummaryPinnedPreference()).toBe(true)

      publishThreadSummaryPreference({ isPinned: false, isPopoverOpen: true })
      expect(stored.get(THREAD_SUMMARY_PINNED_STORAGE_KEY)).toBe('false')

      // 浮层开合不写存储：只有置顶偏好是持久 UI 偏好。
      publishThreadSummaryPreference({ isPinned: false, isPopoverOpen: false })
      expect(stored.get(THREAD_SUMMARY_PINNED_STORAGE_KEY)).toBe('false')
      expect([...stored.keys()]).toEqual([THREAD_SUMMARY_PINNED_STORAGE_KEY])
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })
})

describe('thread summary view model', () => {
  test('derives all five real-data sections and selects the latest valid plan', () => {
    const events = [
      {
        id: 'plan-1',
        type: 'proposed_plan',
        content: '# 旧计划',
      },
      {
        id: 'empty-plan',
        type: 'proposed_plan',
        content: '   ',
      },
      {
        id: 'plan-2',
        type: 'proposed_plan',
        content: '# 新计划\n\n内容',
      },
    ]
    const model = deriveThreadSummaryViewModel({
      additions: 12,
      branchName: ' feature/summary ',
      changedFileCount: 3,
      deletions: 4,
      events,
      sources: [{ label: 'OpenAI', url: 'https://openai.com/' }],
      subagents: [
        {
          task: { id: 'task-1', displayName: '资料梳理' },
          currentRun: { status: 'running' },
        },
      ] as never,
      workspacePath: 'F:\\CodeProject\\CodePilotX-Ts',
    })

    expect(model.environment).toEqual({
      workspacePath: 'F:\\CodeProject\\CodePilotX-Ts',
      branchName: 'feature/summary',
      changedFileCount: 3,
      commitOrPushEnabled: true,
      commitOrPushDisabledReason: null,
      createPullRequestEnabled: true,
      createPullRequestDisabledReason: null,
    })
    expect(model.changes).toEqual({
      fileCount: 3,
      additions: 12,
      deletions: 4,
    })
    expect(model.plan).toEqual({
      eventId: 'plan-2',
      title: '新计划',
      content: '# 新计划\n\n内容',
      openable: true,
    })
    expect(model.sources).toHaveLength(1)
    expect(model.subagents).toEqual([{ id: 'task-1', name: '资料梳理', status: 'running' }])
  })

  test('hides empty sections and ignores malformed plans', () => {
    const model = deriveThreadSummaryViewModel({
      additions: 0,
      branchName: null,
      changedFileCount: 0,
      deletions: 0,
      events: [{ type: 'proposed_plan', content: 42 }],
      sources: [],
      subagents: [],
      workspacePath: null,
    })

    expect(model).toEqual({
      environment: null,
      changes: null,
      plan: null,
      sources: [],
      subagents: [],
    })
    expect(findLatestThreadSummaryPlan([])).toBeNull()
  })

  test('skips a plan that is still streaming and falls back to the latest completed one', () => {
    const events = [
      { id: 'plan-done', type: 'proposed_plan', content: '# 已完成计划' },
      {
        id: 'plan-streaming',
        type: 'proposed_plan',
        content: '# 正在生成',
        metadata: { streaming: true },
      },
    ]

    // 流式中的计划还没有生成完成，右栏只能拿完成态快照。
    expect(findLatestThreadSummaryPlan(events)).toEqual({
      eventId: 'plan-done',
      title: '已完成计划',
      content: '# 已完成计划',
      openable: true,
    })
    expect(
      findLatestThreadSummaryPlan([
        {
          id: 'only-streaming',
          type: 'proposed_plan',
          content: '# 正在生成',
          metadata: { streaming: true },
        },
      ]),
    ).toBeNull()
  })

  test('keeps the changes entry for a workspace with no changes and explains disabled Git actions', () => {
    const model = deriveThreadSummaryViewModel({
      additions: 0,
      branchName: '  ',
      changedFileCount: 0,
      deletions: 0,
      events: [],
      sources: [],
      subagents: [],
      workspacePath: 'F:\\CodeProject\\CodePilotX-Ts',
    })

    expect(model.environment).toMatchObject({
      branchName: null,
      changedFileCount: 0,
      commitOrPushEnabled: true,
      commitOrPushDisabledReason: null,
      createPullRequestEnabled: false,
      createPullRequestDisabledReason: '创建拉取请求前需要先创建或检出 Git 分支',
    })
    expect(model.changes).toEqual({
      fileCount: 0,
      additions: 0,
      deletions: 0,
    })
  })

  test('previews the first three sources for the summary side panel', () => {
    const sources = Array.from({ length: 7 }, (_, index) => ({
      label: `来源 ${index + 1}`,
      url: `https://example.com/${index + 1}`,
    }))

    expect(previewThreadSummarySources(sources)).toEqual({
      items: sources.slice(0, 3),
      totalCount: 7,
    })
  })
})
