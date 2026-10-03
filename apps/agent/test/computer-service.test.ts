import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { ComputerUseService } from '../src/computer/ComputerUseService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import type { ConfigService, ConfigEdit } from '../src/config/ConfigService'
import { computerToolDefinitions } from '../src/tool/Computer/definition'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import type { ToolInvocation } from '../src/domain'
import type { ComputerCommand, ComputerResult, ComputerWindow } from '@codepilotx/agent-protocol'
import { removeFixturePaths } from './fixture-cleanup'

const paths: string[] = []
const cleanups: Array<() => void> = []
const HOST = { instanceId: 'instance:test', connectionId: 'connection:test' }
const APP = { appId: 'aumid:notepad', name: '记事本', pid: 42, windowId: '7', processKey: '1:2' }
const REF = 'window:issued'

type Identity = { threadID: string; turnID: string }

const issuedWindow = (ref = REF): ComputerWindow => ({ ref, ...APP })

afterEach(async () => {
  cleanups.splice(0).forEach((fn) => fn())
  await removeFixturePaths(paths.splice(0))
}, 30_000)

async function fixture(options: { enabled?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cpx-computer-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  const configuration: Record<string, any> = {
    desktop: {
      computerUseEnabled: options.enabled ?? true,
      computerAppPermissions: [],
      unknown: 'keep',
    },
  }
  const config = {
    snapshot: () => configuration,
    read: async () => ({
      config: configuration,
      layers: [{ kind: 'user', version: 'test', config: configuration }],
    }),
    batchWrite: async ({ edits }: { edits: ConfigEdit[] }) => {
      for (const edit of edits) configuration[edit.keyPath[0]!][edit.keyPath[1]!] = edit.value
    },
  } as unknown as ConfigService
  const hub = await Effect.runPromise(EventHub.make)
  const computer = new ComputerUseService(config, db, hub)
  cleanups.push(() => {
    computer.dispose()
    db.close()
  })
  computer.register(HOST.instanceId, HOST.connectionId, true)
  return { db, computer, configuration }
}

const computerTools = (registry: ToolRegistry, mode: 'chat' | 'plan') =>
  registry
    .list(mode)
    .map((tool) => tool.sdkName)
    .filter((name) => name.startsWith('Computer'))
    .sort()

async function discover(computer: ComputerUseService, identity: Identity, signal: AbortSignal) {
  const listed = computer.list(identity, signal)
  const command = await take(computer)
  computer.complete(command.requestId, command.generation, {
    text: '发现 1 个窗口',
    windows: [issuedWindow()],
  })
  return listed
}

async function take(computer: ComputerUseService): Promise<ComputerCommand> {
  const command = await commandWithin(computer)
  expect(command).not.toBeNull()
  return command!
}

/** A dispatchable command resolves at once; otherwise the long-poll is abandoned. */
async function commandWithin(
  computer: ComputerUseService,
  waitMs = 100,
): Promise<ComputerCommand | null> {
  const result = await Promise.race([
    computer.next(),
    Bun.sleep(waitMs).then(() => null),
  ])
  return result ? result.command : null
}

async function observe(
  computer: ComputerUseService,
  identity: Identity,
  signal: AbortSignal,
  result: ComputerResult,
): Promise<string> {
  const reading = computer.read(identity, REF, signal)
  const command = await take(computer)
  computer.complete(command.requestId, command.generation, result)
  const text = (await reading).text ?? ''
  return /observationId: (\S+)/.exec(text)?.[1] ?? ''
}

describe('ComputerUseService', () => {
  test('设置只发现应用标识，手动允许后才可在不询问模式读取，撤销后重新要求授权', async () => {
    const { computer, db } = await fixture()
    const discovery = computer.discoverApplications()
    const command = await take(computer)
    expect(command.kind).toBe('list')
    computer.complete(command.requestId, command.generation, { text: '应用', windows: [issuedWindow()] })
    expect(await discovery).toEqual({ apps: [{ appId: APP.appId, name: APP.name }] })
    expect(computer.state()).toMatchObject({ ownerTurnId: null, permissions: [] })
    await expect(computer.configure({ appId: 'forged', decision: 'allow' })).rejects.toThrow('请先发现')
    await computer.configure({ appId: APP.appId, decision: 'allow' })
    const identity = { threadID: db.createThread('手动授权').id, turnID: 'turn:manual' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    expect(computer.inspect(identity, REF, true).ruleRequiresApproval).toBe(false)
    await expect(computer.discoverApplications()).rejects.toThrow('另一个聊天回合')
    await computer.configure({ appId: APP.appId, decision: 'remove' })
    await discover(computer, { ...identity, turnID: 'turn:after' }, signal)
    expect(computer.inspect({ ...identity, turnID: 'turn:after' }, REF, false).ruleRequiresApproval).toBe(true)
  })

  test('停止后的宿主即使错过唤醒也立即收到新 generation', async () => {
    const { computer } = await fixture()
    const first = await computer.next('generation:old')
    computer.stop()
    const result = await Promise.race([computer.next(first.generation), Bun.sleep(100).then(() => null)])
    expect(result).not.toBeNull()
    expect(result?.generation).not.toBe(first.generation)
    expect(result?.command).toBeNull()
  })

  test('never 拒绝新应用授权，允许询问时走审批，已手动授权时 never 可读取', async () => {
    const { computer, db } = await fixture()
    const registry = new ToolRegistry()
    for (const definition of computerToolDefinitions(computer)) registry.register(definition)
    const tool = registry.get('ComputerRead')
    const identity = { threadID: db.createThread('授权策略').id, turnID: 'turn:policy' }
    await discover(computer, identity, new AbortController().signal)
    const scope = computer.inspect(identity, REF, false)
    const invocation: ToolInvocation = {
      id: 'tool:read', ...identity, agentID: 'main', name: 'ComputerRead', input: { windowRef: REF },
      permissionConfig: { sandboxMode: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user' },
      taskMode: 'chat', model: {} as ToolInvocation['model'], authorizationScope: scope,
    }
    const engine = new PermissionDecisionEngine()
    expect(engine.evaluate(invocation, tool).action).toBe('deny')
    expect(engine.evaluate({ ...invocation, permissionConfig: { ...invocation.permissionConfig, approvalPolicy: 'on-request' } }, tool).action).toBe('review')
    await observe(computer, identity, new AbortController().signal, { text: '窗口' })
    await computer.configure({ appId: APP.appId, decision: 'allow' })
    const next = { ...identity, turnID: 'turn:policy-next' }
    await discover(computer, next, new AbortController().signal)
    expect(engine.evaluate({ ...invocation, ...next, authorizationScope: computer.inspect(next, REF, false) }, tool).action).toBe('allow')
  })

  test('宿主发放的窗口引用不被改写，模型提供的引用必须来自发现结果', async () => {
    const { db, computer } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const result = await discover(computer, identity, new AbortController().signal)
    expect(result.text).toBe(JSON.stringify([{ ref: REF, name: APP.name }]))
    expect(() => computer.inspect(identity, 'window:forged', false)).toThrow('窗口引用已失效')
  })

  test('未授权应用要求审批，读取成功后本聊天放行，持久化拒绝优先', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const signal = new AbortController().signal
    await discover(computer, { threadID: thread.id, turnID: 'turn:1' }, signal)

    expect(
      computer.inspect({ threadID: thread.id, turnID: 'turn:1' }, REF, false),
    ).toMatchObject({ computerApp: { name: APP.name }, ruleRequiresApproval: true })

    await observe(computer, { threadID: thread.id, turnID: 'turn:1' }, signal, {
      text: '窗口内容',
    })
    expect(computer.inspect({ threadID: thread.id, turnID: 'turn:1' }, REF, false)).toMatchObject({
      ruleRequiresApproval: false,
    })
    expect(computer.state().permissions).toEqual([
      { appId: APP.appId, name: APP.name, decision: 'session' },
    ])

    // Recording a decision retires the current control turn and its window
    // references, so the next turn re-discovers before reading the deny.
    await computer.configure({ appId: APP.appId, decision: 'deny' })
    expect(computer.state().permissions).toEqual([
      { appId: APP.appId, name: APP.name, decision: 'deny' },
    ])
    await discover(computer, { threadID: thread.id, turnID: 'turn:2' }, signal)
    expect(() =>
      computer.inspect({ threadID: thread.id, turnID: 'turn:2' }, REF, false),
    ).toThrow('此应用的电脑控制权限已拒绝')

    await computer.configure({ appId: APP.appId, decision: 'remove' })
    expect(computer.state().permissions).toEqual([])
    await discover(computer, { threadID: thread.id, turnID: 'turn:3' }, signal)
    expect(
      computer.inspect({ threadID: thread.id, turnID: 'turn:3' }, REF, false),
    ).toMatchObject({ ruleRequiresApproval: true })
  })

  test('Plan 模式只能读取已授权窗口，ComputerAction 不进入 Plan 工具表', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)

    expect(() => computer.inspect(identity, REF, true)).toThrow('Plan 模式只能读取已授权应用')
    const registry = new ToolRegistry()
    for (const definition of computerToolDefinitions(computer)) registry.register(definition)
    expect(computerTools(registry, 'plan')).toEqual(['ComputerApps', 'ComputerRead'])
    expect(computerTools(registry, 'chat')).toEqual([
      'ComputerAction',
      'ComputerApps',
      'ComputerRead',
    ])

    await observe(computer, identity, signal, { text: '窗口内容' })
    expect(computer.inspect(identity, REF, true).ruleRequiresApproval).toBe(false)
  })

  test('观察失效与元素越界都被拒绝', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    // Actions require the app to be granted by an earlier successful read.
    await observe(computer, identity, signal, { text: '窗口内容' })

    await expect(
      computer.action(
        identity,
        REF,
        'observation:unknown',
        { action: 'click', elementToken: 's00000001:4', delivery: 'background' },
        signal,
      ),
    ).rejects.toThrow('观察已失效')

    const observationId = await observe(computer, identity, signal, {
      text: '窗口内容',
      snapshotId: 's00000001',
      captureId: 'capture:1',
      elementTokens: ['s00000001:4'],
    })
    await expect(
      computer.action(
        identity,
        REF,
        observationId,
        { action: 'click', elementToken: 's00000001:9', delivery: 'background' },
        signal,
      ),
    ).rejects.toThrow('元素不属于当前窗口观察')
  })

  test('坐标操作绑定截图，前台重试携带新的观察且观察用后即失效', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)

    // A read without a capture cannot ground coordinates.
    const withoutCapture = await observe(computer, identity, signal, {
      text: '窗口内容',
      snapshotId: 's00000001',
      elementTokens: [],
    })
    await expect(
      computer.action(
        identity,
        REF,
        withoutCapture,
        { action: 'click', x: 10, y: 20, delivery: 'background' },
        signal,
      ),
    ).rejects.toThrow('坐标操作需要有效截图')

    const observationId = await observe(computer, identity, signal, {
      text: '窗口内容',
      snapshotId: 's00000002',
      captureId: 'capture:2',
      elementTokens: [],
    })
    const acting = computer.action(
      identity,
      REF,
      observationId,
      { action: 'click', x: 10, y: 20, delivery: 'foreground' },
      signal,
    )
    const command = await take(computer)
    expect(command).toMatchObject({
      kind: 'action',
      captureId: 'capture:2',
      operation: { action: 'click', x: 10, y: 20, delivery: 'foreground' },
    })
    computer.complete(command.requestId, command.generation, { text: '已点击' })
    await acting

    // The observation is consumed, so a retry needs a fresh read.
    await expect(
      computer.action(
        identity,
        REF,
        observationId,
        { action: 'click', x: 10, y: 20, delivery: 'foreground' },
        signal,
      ),
    ).rejects.toThrow('观察已失效')
  })

  test('同一真实桌面只允许一个聊天回合控制，其他聊天不排队', async () => {
    const { computer, db } = await fixture()
    const owner = db.createThread('拥有者')
    const other = db.createThread('其他')
    const signal = new AbortController().signal
    const ownerIdentity = { threadID: owner.id, turnID: 'turn:owner' }
    await discover(computer, ownerIdentity, signal)

    const reading = computer.read(ownerIdentity, REF, signal)
    const command = await take(computer)

    expect(() =>
      computer.inspect({ threadID: other.id, turnID: 'turn:other' }, REF, false),
    ).toThrow('电脑正由另一个聊天回合控制')
    expect(computer.state()).toMatchObject({ ownerThreadId: owner.id, ownerTurnId: 'turn:owner' })
    expect(computer.state().busy).toBe(true)
    // The other chat gets a busy signal, not a queued command.
    expect(await commandWithin(computer)).toBeNull()

    computer.complete(command.requestId, command.generation, { text: '窗口内容' })
    await reading
  })

  test('停止清空待执行命令、失效引用并禁止本回合继续，迟到结果不生效', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)

    const reading = computer.read(identity, REF, signal)
    const command = await take(computer)
    computer.stop()

    await expect(reading).rejects.toThrow('电脑控制已停止')
    expect(await commandWithin(computer)).toBeNull()
    expect(() => computer.inspect(identity, REF, false)).toThrow('本回合电脑控制已停止')
    computer.complete(command.requestId, command.generation, { text: '迟到的结果' })
    expect(computer.state()).toMatchObject({
      ownerThreadId: null,
      ownerTurnId: null,
      targetName: null,
      busy: false,
    })
  })

  test('宿主断开释放控制权、清除聊天授权并保留持久化设置', async () => {
    const { computer, db, configuration } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    await observe(computer, identity, signal, { text: '窗口内容' })
    await computer.configure({ appId: APP.appId, decision: 'allow' })

    computer.release(HOST.instanceId)

    expect(computer.state()).toMatchObject({
      available: false,
      ownerThreadId: null,
      ownerTurnId: null,
      permissions: [{ appId: APP.appId, name: APP.name, decision: 'allow' }],
    })
    expect(configuration.desktop.unknown).toBe('keep')
    expect(() =>
      computer.inspect({ threadID: thread.id, turnID: 'turn:2' }, REF, false),
    ).toThrow('请开启电脑控制')
  })

  test('功能关闭时工具不暴露且命令被拒绝', async () => {
    const { computer, db } = await fixture({ enabled: false })
    const thread = db.createThread('电脑')
    expect(computer.available()).toBe(false)
    await expect(
      computer.list({ threadID: thread.id, turnID: 'turn:1' }, new AbortController().signal),
    ).rejects.toThrow('请开启电脑控制')
    const registry = new ToolRegistry()
    for (const definition of computerToolDefinitions(computer)) registry.register(definition)
    expect(computerTools(registry, 'chat')).toEqual([])
  })

  test('未完成握手的宿主动作被拒绝', async () => {
    const { computer } = await fixture()
    expect(() => computer.requireHost('instance:other', HOST.connectionId)).toThrow(
      '电脑宿主连接已失效',
    )
    expect(() => computer.requireHost(HOST.instanceId, HOST.connectionId)).not.toThrow()
    expect(computer.state().available).toBe(true)
  })
})
