import { afterEach, expect, spyOn, test } from 'bun:test'
import type { DesktopModelProviderState, DesktopSessionSnapshot } from '../shared/types.js'
import { agentThreadSnapshotToDesktop, desktopPermissionModeToPermissionConfig } from '../src/services/agentThreadAdapter.js'
import { desktopClient } from '../src/services/desktop-client/index.js'
import { sessionModelSelections as store } from '../src/features/session/state/sessionModelSelectionStore.js'

const ids = ['selection-a', 'selection-b', 'selection-empty', 'selection-error', 'selection-late']
const spies: Array<{ mockRestore(): void }> = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  for (const id of [...ids, null]) store.delete(id)
})
const defaults: DesktopModelProviderState = {
  selectedProviderID: 'openai', model: 'default-model', models: ['default-model'],
  provider: { providerID: 'openai', displayName: 'OpenAI', kind: 'openai', apiKeyConfigured: true, defaultModels: ['default-model'] },
  baseURL: '', apiKeyConfigured: true, apiKeySource: null, modelConfigured: true,
}
function snapshot(id: string, model?: string): DesktopSessionSnapshot {
  const result = agentThreadSnapshotToDesktop({
    thread: { id, title: id, projectID: null, gitBranch: null,
      workspace: { kind: 'standalone', projectID: null, workspaceRoot: null, cwd: '/tmp', outputDirectory: '/tmp' },
      settings: { taskMode: 'chat', permissionConfig: desktopPermissionModeToPermissionConfig('default') },
      archivedAt: null, createdAt: 1, updatedAt: 1 },
    turns: [], inputs: [], agents: [], messages: [], items: [], approvals: [],
  })
  result.settings = { ...result.settings, providerID: model ? 'deepseek' : undefined, model, thinkingMode: 'enabled', variant: model ? 'high' : undefined }
  // List summaries deliberately contain no model; restoration must use the full settings.
  result.item.model = null
  return result
}

test('A/B retain independent unsent choices and reload actual history after memory is discarded', async () => {
  const history = spyOn(desktopClient, 'getSession').mockImplementation(async id => snapshot(id, `history-${id}`))
  const global = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(defaults)
  const save = spyOn(desktopClient, 'saveModelProvider').mockRejectedValue(new Error('must not save defaults'))
  spies.push(history, global, save)
  expect(await store.load(ids[0]!)).toMatchObject({ model: `history-${ids[0]}`, variant: 'high' })
  store.set(ids[0]!, { providerID: 'openai', model: 'unsent-a', thinkingMode: 'adaptive', variant: 'adaptive' })
  await store.load(ids[1]!)
  expect(await store.load(ids[0]!)).toMatchObject({ model: 'unsent-a', thinkingMode: 'adaptive' })
  expect(store.getSnapshot(ids[1]!).selection?.model).toBe(`history-${ids[1]}`)
  store.delete(ids[0]!)
  expect(await store.load(ids[0]!)).toMatchObject({ model: `history-${ids[0]}`, thinkingMode: 'enabled', variant: 'high' })
  expect(global).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test('a delayed empty history uses global defaults only after confirming it has no model', async () => {
  let release!: (snapshot: DesktopSessionSnapshot) => void
  const history = spyOn(desktopClient, 'getSession').mockImplementation(() => new Promise(resolve => { release = resolve }))
  const global = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(defaults)
  spies.push(history, global)
  store.set(ids[0]!, { providerID: 'deepseek', model: 'a', thinkingMode: 'enabled' })
  const pending = store.load(ids[2]!)
  const repeated = store.load(ids[2]!)
  expect(store.getSnapshot(ids[2]!)).toEqual({ selection: null, loading: true, error: null })
  expect(history).toHaveBeenCalledTimes(1)
  expect(global).not.toHaveBeenCalled()
  release(snapshot(ids[2]!))
  await repeated
  expect(await pending).toEqual({ providerID: 'openai', model: 'default-model', thinkingMode: 'default' })
  expect(store.getSnapshot(ids[0]!).selection?.model).toBe('a')
})

test('history failures remain visible and retry restores the same thread', async () => {
  const history = spyOn(desktopClient, 'getSession').mockRejectedValueOnce(new Error('history unavailable')).mockResolvedValue(snapshot(ids[3]!, 'recovered'))
  const global = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(defaults)
  spies.push(history, global)
  await expect(store.load(ids[3]!)).rejects.toThrow('history unavailable')
  expect(store.getSnapshot(ids[3]!)).toEqual({ selection: null, loading: false, error: 'history unavailable' })
  expect(await store.load(ids[3]!)).toMatchObject({ model: 'recovered' })
  expect(store.getSnapshot(ids[3]!).error).toBeNull()
  expect(global).not.toHaveBeenCalled()
})

test('late historical success cannot replace an explicit draft', async () => {
  let release!: (snapshot: DesktopSessionSnapshot) => void
  spies.push(spyOn(desktopClient, 'getSession').mockImplementation(() => new Promise(resolve => { release = resolve })))
  const pending = store.load(ids[4]!)
  const choice = { providerID: 'openai', model: 'chosen', thinkingMode: 'default' as const }
  store.set(ids[4]!, choice)
  release(snapshot(ids[4]!, 'stale'))
  expect(await pending).toEqual(choice)
  expect(store.getSnapshot(ids[4]!).selection).toEqual(choice)
})

test('late historical failure cannot reject a selection that was explicitly restored meanwhile', async () => {
  let reject!: (error: Error) => void
  spies.push(spyOn(desktopClient, 'getSession').mockImplementation(() => new Promise((_, fail) => { reject = fail })))
  const pending = store.load(ids[4]!)
  const choice = { providerID: 'openai', model: 'chosen', thinkingMode: 'default' as const }
  store.set(ids[4]!, choice)
  reject(new Error('old request failed'))
  expect(await pending).toEqual(choice)
  expect(store.getSnapshot(ids[4]!).error).toBeNull()
})
