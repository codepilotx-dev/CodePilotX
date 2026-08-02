import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createDefaultConversationUiState,
  loadConversationUiState,
  saveConversationUiState,
  transferConversationUiStateForHandoff,
} from '../src/features/layout/tabs/conversationUiState.js'

describe('Handoff UI transfer', () => {
  beforeEach(() => installStorage(new MemoryStorage()))

  test('copies logical terminal state without old workspace paths or history IDs', () => {
    const source = createDefaultConversationUiState()
    source.sideChatAttachments = [{
      id: 'attachment-1',
      name: 'old.txt',
      path: 'F:\\managed-worktree\\old.txt',
      mediaType: 'text/plain',
      sizeBytes: 3,
      kind: 'file',
      status: 'ready',
    }]
    source.review.source = {
      kind: 'last-turn',
      threadId: 'source-thread',
      turnId: 'source-turn',
    }
    source.workbench.tabsById = {
      terminal: { id: 'terminal', kind: 'terminal' },
      'file:old.txt': {
        id: 'file:old.txt',
        kind: 'file-preview',
        workspacePath: 'F:\\managed-worktree',
        relativePath: 'old.txt',
        preview: false,
      },
      'plan:source-event': {
        id: 'plan:source-event',
        kind: 'plan',
        eventId: 'source-event',
        title: '旧计划',
      },
    }
    source.workbench.bottom = {
      open: true,
      activeTabId: 'terminal',
      tabIds: ['terminal', 'file:old.txt', 'plan:source-event'],
    }
    saveConversationUiState('source-thread', source)

    expect(transferConversationUiStateForHandoff({
      sourceThreadId: 'source-thread',
      targetThreadId: 'target-thread',
      sourceWorkspacePath: 'F:\\managed-worktree',
    })).toEqual({ transferred: true })

    const target = loadConversationUiState('target-thread')
    expect(target?.workbench.tabsById).toEqual({
      terminal: { id: 'terminal', kind: 'terminal' },
    })
    expect(target?.workbench.bottom.tabIds).toEqual(['terminal'])
    expect(target?.review.source).toEqual({ kind: 'unstaged' })
    expect(target?.sideChatAttachments).toEqual([])
  })
})

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()
  get length(): number { return this.#values.size }
  clear(): void { this.#values.clear() }
  getItem(key: string): string | null { return this.#values.get(key) ?? null }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string): void { this.#values.delete(key) }
  setItem(key: string, value: string): void { this.#values.set(key, value) }
}

function installStorage(localStorage: Storage): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  })
}
