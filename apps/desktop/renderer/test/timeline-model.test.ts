import { describe, expect, test } from 'bun:test'
import type {
  DesktopSessionEvent,
  DesktopSessionStatus,
} from '../shared/types.js'
import {
  deriveConversationTurnNavItems,
  groupTimelineExecutionPhases,
  groupTimelineToolEvents,
} from '../src/features/session/timelineModel.js'

function event(
  id: string,
  type: DesktopSessionEvent['type'],
  overrides: Partial<DesktopSessionEvent> = {},
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type,
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  }
}

describe('timeline model', () => {
  test('groups tool runs without stopping the active final run', () => {
    const items = groupTimelineToolEvents([
      event('call-1', 'tool_call', {
        content: 'Bash: bun test',
        metadata: { toolName: 'Bash', toolUseId: 'tool-1' },
      }),
      event('output-1', 'tool_output_delta', {
        content: 'running',
        metadata: { toolName: 'Bash', toolUseId: 'tool-1' },
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('tool_group')
    if (items[0]?.type !== 'tool_group') return
    expect(items[0].runs[0]).toMatchObject({
      outputContent: 'running',
      isRunning: true,
      isError: false,
    })
  })

  test('keeps plan execution items grouped and turn navigation row-stable', () => {
    const grouped = groupTimelineToolEvents([
      event('user-1', 'message', { role: 'user', content: '修改主题' }),
      event('plan-1', 'proposed_plan', {
        role: 'assistant',
        content: '# 计划',
      }),
      event('patch-1', 'file_patch', {
        metadata: {
          turnScoped: true,
          files: [{ path: 'src/theme.ts' }],
        },
      }),
      event('assistant-1', 'message', {
        role: 'assistant',
        content: '已完成',
      }),
      event('checkpoint-1', 'checkpoint'),
    ])
    const phases = groupTimelineExecutionPhases(
      grouped,
      'idle' as DesktopSessionStatus,
    )
    const navItems = deriveConversationTurnNavItems(phases)

    expect(phases.map(item => item.type)).toEqual([
      'message',
      'proposed_plan',
      'file_patch',
      'message',
      'checkpoint',
    ])
    expect(navItems).toEqual([
      {
        id: 'user-1',
        rowIndex: 0,
        userText: '修改主题',
        assistantText: '已完成',
        files: ['src/theme.ts'],
      },
    ])
  })
})
