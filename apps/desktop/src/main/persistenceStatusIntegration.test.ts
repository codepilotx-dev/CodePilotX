import { expect, test } from 'bun:test'
import { createRolloutWriteScheduler } from './desktopRolloutPersistence.js'
import { createSessionPersistScheduler } from './sessionPersistScheduler.js'
import { createSessionStoreChangeEmitter } from './sessionStoreChangeEmitter.js'
import {
  applyDesktopPersistenceStatusToSnapshot,
  createDesktopSessionSnapshot,
  createLightweightDesktopSessionSnapshot,
} from './sessionPersistence.js'
import { conversationPersistenceLabel } from '../renderer/features/session/ConversationPage.js'

test('main persistence sources keep renderer warning until both recover and reload clears it', async () => {
  let snapshot = newSnapshot()
  let sessionStoreUnsaved = false
  const unsavedRollouts = new Set<string>()
  let rendererStatus: 'saved' | 'unsaved' | undefined
  const emitter = createSessionStoreChangeEmitter({
    debounceMs: 0,
    emit: () => {
      rendererStatus = createLightweightDesktopSessionSnapshot(snapshot).item.persistenceStatus
    },
  })
  const publish = () => {
    const rolloutPath = snapshot.item.rolloutPath!
    snapshot = applyDesktopPersistenceStatusToSnapshot(
      snapshot,
      sessionStoreUnsaved || unsavedRollouts.has(rolloutPath) ? 'unsaved' : 'saved',
    )
    emitter.requestEmit({ immediate: true })
  }

  let storeFails = true
  const storeScheduler = createSessionPersistScheduler({
    debounceMs: 0,
    retryDelaysMs: [],
    getState: () => snapshot,
    save: async () => {
      if (storeFails) throw Object.assign(new Error('store full'), { code: 'ENOSPC' })
    },
    onStatusChange: status => {
      sessionStoreUnsaved = status === 'unsaved'
      publish()
    },
  })
  let rolloutFails = true
  const rolloutScheduler = createRolloutWriteScheduler({
    retryDelaysMs: [],
    writeItems: async () => {
      if (rolloutFails) throw Object.assign(new Error('rollout denied'), { code: 'EACCES' })
    },
    onStatusChange: (status, rolloutPath) => {
      if (status === 'unsaved') unsavedRollouts.add(rolloutPath)
      else unsavedRollouts.delete(rolloutPath)
      publish()
    },
  })

  storeScheduler.requestSave({ immediate: true })
  rolloutScheduler.append(snapshot.item.rolloutPath!, [{
    type: 'event_msg',
    payload: { eventType: 'message', role: 'assistant', content: 'done' },
  }])
  await Promise.allSettled([storeScheduler.flush(), rolloutScheduler.flush()])
  expect(conversationPersistenceLabel(rendererStatus)).toBe('会话未保存')

  rolloutFails = false
  await rolloutScheduler.flush()
  expect(conversationPersistenceLabel(rendererStatus)).toBe('会话未保存')

  storeFails = false
  await storeScheduler.flush()
  expect(conversationPersistenceLabel(rendererStatus)).toBeNull()

  rendererStatus = undefined
  snapshot = newSnapshot()
  sessionStoreUnsaved = false
  unsavedRollouts.clear()
  publish()
  expect(conversationPersistenceLabel(rendererStatus)).toBeNull()
})

function newSnapshot() {
  return createDesktopSessionSnapshot({
    sessionId: 'persistence-integration',
    workspace: {
      path: 'D:\\workspace',
      name: 'workspace',
      branchName: null,
      isGitRepo: false,
    },
    standalone: false,
    settings: {
      permissionMode: 'default',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
  })
}
