import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createDefaultConversationUiState,
  saveConversationUiState,
  loadConversationUiState,
  validateConversationUiState,
  type ConversationUiState,
} from './conversationUiState.js'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
      },
    },
    writable: true,
    configurable: true,
  })
})

const VALID_TOOLS = ['review', 'browser', 'plan', 'files'] as const

function makeState(overrides?: Partial<ConversationUiState>): ConversationUiState {
  return {
    rightDock: { open: true, activeTool: 'plan', openTools: ['review', 'plan'] },
    plan: { title: '计划书', content: '## 计划\n\n实施步骤...' },
    mainScrollTop: 1200,
    sideChatInput: '',
    sideChatAttachments: [],
    ...overrides,
  }
}

describe('saveConversationUiState / loadConversationUiState', () => {
  test('round-trips a full state object', () => {
    const sessionId = 'test-session-1'
    const state = makeState()

    saveConversationUiState(sessionId, state)
    const loaded = loadConversationUiState(sessionId)

    expect(loaded).toEqual(state)
  })

  test('returns null for a session that was never saved', () => {
    expect(loadConversationUiState('never-saved-session')).toBeNull()
  })

  test('each session has independent storage', () => {
    const stateA = makeState({ mainScrollTop: 100 })
    const stateB = makeState({ mainScrollTop: 500 })

    saveConversationUiState('session-A', stateA)
    saveConversationUiState('session-B', stateB)

    expect(loadConversationUiState('session-A')?.mainScrollTop).toBe(100)
    expect(loadConversationUiState('session-B')?.mainScrollTop).toBe(500)
  })

  test('overwrites existing state on re-save', () => {
    const sessionId = 'test-session-overwrite'

    saveConversationUiState(sessionId, makeState({ mainScrollTop: 1 }))
    saveConversationUiState(sessionId, makeState({ mainScrollTop: 2 }))

    expect(loadConversationUiState(sessionId)?.mainScrollTop).toBe(2)
  })

  test('round-trips sideChatInput and sideChatAttachments', () => {
    const sessionId = 'test-sidechat-roundtrip'
    const state = makeState({
      sideChatInput: '帮我看看这个文件',
      sideChatAttachments: [
        {
          id: 'att-2',
          name: 'main.ts',
          path: '/src/main.ts',
          mediaType: 'text/typescript',
          sizeBytes: 500,
          kind: 'document',
          status: 'ready',
        },
      ],
    })

    saveConversationUiState(sessionId, state)
    const loaded = loadConversationUiState(sessionId)

    expect(loaded?.sideChatInput).toBe('帮我看看这个文件')
    expect(loaded?.sideChatAttachments).toEqual([
      {
        id: 'att-2',
        name: 'main.ts',
        path: '/src/main.ts',
        mediaType: 'text/typescript',
        sizeBytes: 500,
        kind: 'document',
        status: 'ready',
      },
    ])
  })
})

describe('validateConversationUiState', () => {
  test('passes through a valid state unchanged', () => {
    const state = makeState()
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated).toEqual(state)
  })

  test('filters out unknown tool ids from openTools', () => {
    const state = makeState({
      rightDock: {
        open: true,
        activeTool: 'browser',
        openTools: ['review', 'unknown-tool', 'browser'] as any,
      },
    })
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.rightDock.openTools).toEqual(['review', 'browser'])
    expect(validated.rightDock.activeTool).toBe('browser')
  })

  test('falls back activeTool to last available tool when current is filtered out', () => {
    const state = makeState({
      rightDock: {
        open: true,
        activeTool: 'unknown-tool' as any,
        openTools: ['review', 'plan'] as any,
      },
    })
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.rightDock.activeTool).toBe('plan')
    expect(validated.rightDock.openTools).toEqual(['review', 'plan'])
  })

  test('sets activeTool to null and closes dock when all tools are filtered out', () => {
    const state = makeState({
      rightDock: {
        open: true,
        activeTool: 'unknown-tool-1' as any,
        openTools: ['unknown-tool-1', 'unknown-tool-2'] as any,
      },
    })
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.rightDock.activeTool).toBeNull()
    expect(validated.rightDock.openTools).toEqual([])
    expect(validated.rightDock.open).toBe(false)
  })

  test('forces dock closed when openTools is empty even if open was true', () => {
    const state = makeState({
      rightDock: {
        open: true,
        activeTool: null,
        openTools: [],
      },
    })
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.rightDock.open).toBe(false)
  })

  test('preserves plan document on invalid state', () => {
    const state = makeState({
      rightDock: {
        open: true,
        activeTool: 'bad-tool' as any,
        openTools: ['bad-tool'] as any,
      },
      plan: { title: '留存计划', content: '# 留存计划' },
    })
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.plan).toEqual({ title: '留存计划', content: '# 留存计划' })
    expect(validated.rightDock.open).toBe(false)
  })

  test('preserves scrollTop on validation', () => {
    const state = makeState({ mainScrollTop: 999 })
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.mainScrollTop).toBe(999)
  })

  test('preserves sideChatInput through validation', () => {
    const state = makeState({
      sideChatInput: '帮我查一下代码',
      rightDock: {
        open: true,
        activeTool: 'bad-tool' as any,
        openTools: ['bad-tool'] as any,
      },
    })
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.sideChatInput).toBe('帮我查一下代码')
  })

  test('preserves sideChatAttachments through validation', () => {
    const state = makeState({
      sideChatAttachments: [
        {
          id: 'att-1',
          name: 'test.ts',
          path: '/test.ts',
          mediaType: 'text/typescript',
          sizeBytes: 100,
          kind: 'document',
          status: 'ready',
        },
      ],
      rightDock: {
        open: true,
        activeTool: 'bad-tool' as any,
        openTools: ['bad-tool'] as any,
      },
    })
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.sideChatAttachments).toEqual([
      {
        id: 'att-1',
        name: 'test.ts',
        path: '/test.ts',
        mediaType: 'text/typescript',
        sizeBytes: 100,
        kind: 'document',
        status: 'ready',
      },
    ])
  })

  test('defaults sideChatInput to empty string when missing from saved state', () => {
    const state = makeState() as any
    delete state.sideChatInput
    delete state.sideChatAttachments
    const validated = validateConversationUiState(state, VALID_TOOLS)
    expect(validated.sideChatInput).toBe('')
    expect(validated.sideChatAttachments).toEqual([])
  })
})

describe('createDefaultConversationUiState', () => {
  test('returns dock closed, plan null, side chat empty', () => {
    const state = createDefaultConversationUiState()
    expect(state.rightDock.open).toBe(false)
    expect(state.rightDock.activeTool).toBeNull()
    expect(state.rightDock.openTools).toEqual([])
    expect(state.plan).toBeNull()
    expect(state.sideChatInput).toBe('')
    expect(state.sideChatAttachments).toEqual([])
  })
})

describe('backward compatibility', () => {
  test('ignores legacy rightDock.width from saved state', () => {
    const legacyState: any = {
      rightDock: { open: true, activeTool: 'plan', openTools: ['review', 'plan'], width: 720 },
      plan: null,
      mainScrollTop: 0,
      sideChatInput: '',
      sideChatAttachments: [],
    }
    const validated = validateConversationUiState(legacyState, VALID_TOOLS)
    expect(validated.rightDock).not.toHaveProperty('width')
    expect(validated.rightDock.open).toBe(true)
    expect(validated.rightDock.activeTool).toBe('plan')
    expect(validated.rightDock.openTools).toEqual(['review', 'plan'])
  })
})
