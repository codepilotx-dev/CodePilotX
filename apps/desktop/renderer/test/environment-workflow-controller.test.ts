import { describe, expect, test } from 'bun:test'
import type { EnvironmentDomainClient } from '../src/services/desktop-client/environment-domain-client.js'
import type { DesktopTerminalClient } from '../src/services/desktop-client/terminal-client.js'
import { listTerminalActions, runTerminalAction } from '../src/features/session/workflow/actions/terminalActionController.js'
import {
  resumePendingHandoff,
  runHandoff,
} from '../src/features/session/workflow/handoff/handoffController.js'
import {
  buildEnvironmentConfigEdits,
  environmentActionsValue,
  serializeEnvironmentActions,
} from '../src/features/settings/local-environment/localEnvironmentEditorModel.js'

const operation = (patch: Record<string, unknown> = {}) => ({
  operationId: 'handoff-1',
  sourceThreadId: 'source',
  targetThreadId: null,
  direction: 'local-to-worktree' as const,
  status: 'running' as const,
  step: 'preflight' as const,
  revision: 1,
  errorCode: null,
  warnings: [],
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  ...patch,
})

describe('environment workflow controllers', () => {
  test('Handoff 先通过 Agent preflight，进入 stop-source 后才关闭 PTY，再复制 UI 并 ack', async () => {
    const order: string[] = []
    const waiting = operation({
      targetThreadId: 'target',
      status: 'await-client-transfer',
      step: 'await-client-transfer',
      revision: 9,
    })
    const client = {
      startHandoff: async () => { order.push('start'); return { operation: operation() } },
      handoffStatus: async () => { order.push('status'); return { operation: waiting, changed: true } },
      ackHandoff: async () => { order.push('ack'); return { operation: operation({ targetThreadId: 'target', status: 'completed', step: 'complete', revision: 11 }) } },
    } as unknown as EnvironmentDomainClient
    const terminal = {
      closeTerminalForThread: async () => { order.push('close-pty'); return { closed: true } },
    } as Pick<DesktopTerminalClient, 'closeTerminalForThread'>
    const result = await runHandoff({
      sourceThreadId: 'source',
      sourceWorkspacePath: 'F:\\old-worktree',
      destination: { kind: 'worktree', worktreeId: 'worktree-1' },
      client,
      terminal,
      transferUiState: input => { order.push('transfer-ui'); expect(input.targetThreadId).toBe('target'); return { transferred: true } },
    })
    expect(result).toEqual({ targetThreadId: 'target', warning: null, warnings: [] })
    expect(order.indexOf('close-pty')).toBeGreaterThan(order.indexOf('start'))
    expect(order.indexOf('close-pty')).toBeGreaterThan(order.indexOf('status'))
    expect(order.indexOf('close-pty')).toBeLessThan(order.indexOf('transfer-ui'))
    expect(order.at(-1)).toBe('ack')
  })

  test('Handoff preflight 拒绝时不关闭源 PTY', async () => {
    let closed = false
    const failure = new Error('QUEUE_NOT_EMPTY')
    const client = {
      startHandoff: async () => { throw failure },
      handoffStatus: async () => { throw failure },
    } as unknown as EnvironmentDomainClient
    await expect(runHandoff({
      sourceThreadId: 'source',
      sourceWorkspacePath: 'F:\\source',
      destination: { kind: 'worktree', worktreeId: 'worktree-1' },
      client,
      terminal: { closeTerminalForThread: async () => { closed = true; return { closed: true } } },
    })).rejects.toBe(failure)
    expect(closed).toBeFalse()
  })

  test('重启后可按 source task 发现 pending Handoff 并幂等完成客户端迁移', async () => {
    const waiting = operation({
      targetThreadId: 'target',
      status: 'await-client-transfer',
      step: 'await-client-transfer',
      revision: 9,
    })
    const order: string[] = []
    const client = {
      pendingHandoff: async () => ({ operation: waiting }),
      handoffStatus: async () => ({ operation: waiting, changed: false }),
      ackHandoff: async () => {
        order.push('ack')
        return { operation: operation({ targetThreadId: 'target', status: 'completed', step: 'complete', revision: 11 }) }
      },
    } as unknown as EnvironmentDomainClient
    const result = await resumePendingHandoff({
      sourceThreadId: 'source',
      sourceWorkspacePath: 'F:\\source',
      destination: { kind: 'local' },
      client,
      terminal: { closeTerminalForThread: async () => { order.push('close-pty'); return { closed: true } } },
      transferUiState: () => { order.push('transfer-ui'); return { transferred: true } },
    })
    expect(result?.targetThreadId).toBe('target')
    expect(order).toEqual(['close-pty', 'transfer-ui', 'ack'])
  })

  test('Actions 列表和 Electron 调用都不向 Renderer 暴露 command/env/cwd', async () => {
    const actions = await listTerminalActions({
      listActions: async () => ({
        revision: 'a'.repeat(64),
        actions: [{ name: 'test', icon: 'play', availability: 'available' }],
      }),
    }, 'thread-1')
    expect(JSON.stringify(actions)).not.toMatch(/command|\benv\b|cwd/i)
    let terminalInput: unknown
    let terminalEvent: Event | null = null
    const actionSnapshot = { terminalId: 'terminal-action', instanceId: 'instance-action' }
    await runTerminalAction({
      threadId: 'thread-1',
      action: actions[0]!,
      profileId: null,
      terminal: {
        runTerminalAction: async input => {
          terminalInput = input
          return actionSnapshot as never
        },
      },
      dispatch: event => { terminalEvent = event; return true },
    })
    expect(terminalInput).toEqual({
      threadId: 'thread-1',
      actionName: 'test',
      profileId: null,
      cols: 120,
      rows: 30,
    })
    expect(JSON.stringify(terminalInput)).not.toMatch(/command|\benv\b|cwd/i)
    expect((terminalEvent as unknown as CustomEvent).detail.snapshot).toBe(actionSnapshot)
  })

  test('Local environment Actions 以结构化字段读取并压缩保存', () => {
    const actions = environmentActionsValue([{
      name: 'Test', icon: 'play', command: 'bun test', windows: 'bun test --watch=false', macos: '', linux: '',
    }])
    expect(actions[0]).toEqual({
      sourceIndex: 0, name: 'Test', icon: 'play', command: 'bun test', windows: 'bun test --watch=false', macos: '', linux: '',
    })
    expect(serializeEnvironmentActions(actions)).toEqual([{
      name: 'Test', icon: 'play', command: 'bun test', windows: 'bun test --watch=false',
    }])
    expect(() => serializeEnvironmentActions([...actions, { ...actions[0]!, name: 'test' }])).toThrow('Action 名称重复')
  })

  test('Local environment 保存只 patch 已知嵌套字段，不整块覆盖未知键', () => {
    const original = {
      setup: { script: 'old', future: true },
      actions: [{ name: 'Dev', command: 'old', future: { keep: true } }],
    }
    const actions = environmentActionsValue(original.actions)
    actions[0] = { ...actions[0]!, command: 'bun dev' }
    const edits = buildEnvironmentConfigEdits({
      original,
      name: 'Project',
      setup: { script: 'bun setup' },
      cleanup: { script: '' },
      actions,
    })
    expect(edits.some(edit => edit.keyPath.length === 1 && edit.keyPath[0] === 'actions')).toBeFalse()
    expect(edits).toContainEqual({ keyPath: ['setup', 'script'], value: 'bun setup' })
    expect(edits).toContainEqual({ keyPath: ['actions', 0, 'command'], value: 'bun dev' })
    expect(edits.some(edit => edit.keyPath.includes('future'))).toBeFalse()
  })
})
