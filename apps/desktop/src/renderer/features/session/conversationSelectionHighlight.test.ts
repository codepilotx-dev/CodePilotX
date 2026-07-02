import { describe, expect, test } from 'bun:test'
import {
  clearConversationSelectionHighlight,
  CONVERSATION_SELECTION_HIGHLIGHT_NAME,
  createConversationSelectionSnapshot,
  installConversationSelectionHighlight,
} from './conversationSelectionHighlight.js'

describe('conversation selection highlight', () => {
  test('createConversationSelectionSnapshot clones a non-empty selected range', () => {
    const clonedRange = { id: 'cloned' }
    const sourceRange = {
      collapsed: false,
      cloneRange: () => clonedRange,
    }
    const selection = {
      rangeCount: 1,
      toString: () => '  selected text  ',
      getRangeAt: (index: number) => {
        expect(index).toBe(0)
        return sourceRange
      },
    }

    expect(createConversationSelectionSnapshot(selection)).toEqual({
      text: 'selected text',
      range: clonedRange,
    })
  })

  test('createConversationSelectionSnapshot ignores empty or collapsed selections', () => {
    expect(
      createConversationSelectionSnapshot({
        rangeCount: 0,
        toString: () => 'selected',
        getRangeAt: () => {
          throw new Error('range should not be read')
        },
      }),
    ).toBeNull()
    expect(
      createConversationSelectionSnapshot({
        rangeCount: 1,
        toString: () => '   ',
        getRangeAt: () => ({
          collapsed: false,
          cloneRange: () => ({}),
        }),
      }),
    ).toBeNull()
    expect(
      createConversationSelectionSnapshot({
        rangeCount: 1,
        toString: () => 'selected',
        getRangeAt: () => ({
          collapsed: true,
          cloneRange: () => ({}),
        }),
      }),
    ).toBeNull()
  })

  test('installConversationSelectionHighlight registers and clears a custom highlight', () => {
    const calls: string[] = []
    const registry = {
      set: (name: string, value: unknown) => {
        calls.push(`set:${name}:${String(value)}`)
      },
      delete: (name: string) => {
        calls.push(`delete:${name}`)
        return true
      },
    }
    const scope = {
      CSS: { highlights: registry },
      Highlight: class {
        private readonly range: unknown
        constructor(range: unknown) {
          this.range = range
        }
        toString(): string {
          return `highlight:${String(this.range)}`
        }
      },
    }

    expect(installConversationSelectionHighlight('range', scope)).toBe(true)
    clearConversationSelectionHighlight(scope)

    expect(calls).toEqual([
      `set:${CONVERSATION_SELECTION_HIGHLIGHT_NAME}:highlight:range`,
      `delete:${CONVERSATION_SELECTION_HIGHLIGHT_NAME}`,
    ])
  })
})
