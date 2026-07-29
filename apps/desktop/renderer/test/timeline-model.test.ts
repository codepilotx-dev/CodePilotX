import { describe, expect, test } from 'bun:test'
import type { RenderTurnEntry } from '@codepilotx/session-view'
import { deriveConversationTurnNavItems } from '../src/features/session/conversation/turnNavigationModel.js'
import {
  markdownToTurnPreview,
  shouldShowTurnNavigation,
} from '../src/features/session/conversation/ConversationTurnNavRail.js'

type NavTurn = Pick<
  RenderTurnEntry,
  'id' | 'userInputs' | 'assistantResultItems' | 'patchItems'
>

function navTurn({
  assistantTexts = [],
  files = [],
  id,
  userTexts = [],
}: {
  assistantTexts?: string[]
  files?: string[][]
  id: string
  userTexts?: string[]
}): RenderTurnEntry {
  return {
    id,
    userInputs: userTexts.map((content, index) => ({
      id: `${id}-input-${index}`,
      content,
    })),
    assistantResultItems: assistantTexts.map((text, index) => ({
      id: `${id}-assistant-${index}`,
      text,
    })),
    patchItems: files.map((paths, patchIndex) => ({
      id: `${id}-patch-${patchIndex}`,
      files: paths.map(path => ({ path })),
    })),
  } as NavTurn as RenderTurnEntry
}

describe('canonical conversation navigation', () => {
  test('matches Codex turn navigation visibility boundaries', () => {
    expect(shouldShowTurnNavigation(3, 200)).toBe(false)
    expect(shouldShowTurnNavigation(4, 47.99)).toBe(false)
    expect(shouldShowTurnNavigation(4, 48)).toBe(true)
  })

  test('creates a compact plain-text turn preview from Markdown', () => {
    expect(
      markdownToTurnPreview(
        '# 标题\n\n- 第一项\n- `code` [链接](https://example.com)',
      ),
    ).toBe('标题 第一项 code 链接')
  })

  test('derives canonical turn navigation text and unique file outputs', () => {
    const navItems = deriveConversationTurnNavItems([
      navTurn({
        id: 'turn-1',
        userTexts: ['修改主题', '同时整理高对比主题'],
        assistantTexts: ['已完成 token 调整', '并更新组件样式'],
        files: [
          ['src/theme.ts', 'src\\components\\Button.tsx'],
          ['SRC/THEME.TS', 'src/components/Button.tsx', 'src/panel.tsx'],
        ],
      }),
      navTurn({
        id: 'turn-2',
        userTexts: ['   '],
        assistantTexts: ['', '  '],
        files: [['']],
      }),
    ])

    expect(navItems).toEqual([
      {
        id: 'turn-1',
        rowIndex: 0,
        userText: '修改主题\n同时整理高对比主题',
        assistantText: '已完成 token 调整\n并更新组件样式',
        outputs: [
          { type: 'file', label: 'theme.ts', path: 'src/theme.ts' },
          {
            type: 'file',
            label: 'Button.tsx',
            path: 'src\\components\\Button.tsx',
          },
          { type: 'file', label: 'panel.tsx', path: 'src/panel.tsx' },
        ],
      },
      {
        id: 'turn-2',
        rowIndex: 1,
        userText: '',
        assistantText: null,
        outputs: [],
      },
    ])
  })

  test('keeps canonical turn ids stable while older history changes row indexes', () => {
    const recentTurns = [
      navTurn({ id: 'turn-2', userTexts: ['第二轮'] }),
      navTurn({ id: 'turn-3', userTexts: ['第三轮'] }),
    ]

    expect(deriveConversationTurnNavItems(recentTurns)).toMatchObject([
      { id: 'turn-2', rowIndex: 0 },
      { id: 'turn-3', rowIndex: 1 },
    ])
    expect(
      deriveConversationTurnNavItems([
        navTurn({ id: 'turn-1', userTexts: ['第一轮'] }),
        ...recentTurns,
      ]),
    ).toMatchObject([
      { id: 'turn-1', rowIndex: 0 },
      { id: 'turn-2', rowIndex: 1 },
      { id: 'turn-3', rowIndex: 2 },
    ])
  })
})
