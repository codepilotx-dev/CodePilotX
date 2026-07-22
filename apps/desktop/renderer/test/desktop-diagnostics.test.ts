import { describe, expect, test } from 'bun:test'
import {
  subscribeToDesktopDiagnostics,
  type AgentDiagnostic,
} from '../src/services/desktopDiagnostics.js'

describe('desktop diagnostics', () => {
  test('writes diagnostics to the matching DevTools console level', () => {
    let listener: ((diagnostic: AgentDiagnostic) => void) | undefined
    let removed = false
    const lines: Array<{ level: string; values: unknown[] }> = []
    const unsubscribe = subscribeToDesktopDiagnostics({
      onAgentDiagnostic: callback => {
        listener = callback
        return () => { removed = true }
      },
    }, {
      info: (...values) => lines.push({ level: 'info', values }),
      warn: (...values) => lines.push({ level: 'warn', values }),
      error: (...values) => lines.push({ level: 'error', values }),
    })

    listener?.({
      at: '2026-07-22T03:00:00.000Z',
      level: 'warn',
      source: 'agent',
      code: 'SANDBOX_SETUP_TIMEOUT',
      message: '沙箱初始化超时',
      details: { phase: 'acl', durationMs: 75_000 },
    })
    unsubscribe()

    expect(lines).toEqual([{
      level: 'warn',
      values: [
        '[CodePilotX][agent] SANDBOX_SETUP_TIMEOUT: 沙箱初始化超时',
        { phase: 'acl', durationMs: 75_000 },
      ],
    }])
    expect(removed).toBe(true)
  })
})
