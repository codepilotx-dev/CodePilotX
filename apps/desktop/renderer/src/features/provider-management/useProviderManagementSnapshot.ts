import { useEffect, useSyncExternalStore } from 'react'
import {
  providerManagementStore,
  type ProviderManagementStore,
} from './providerManagementStore.js'
import type { ProviderManagementSnapshot } from './types.js'

export function useProviderManagementSnapshot(
  store: ProviderManagementStore = providerManagementStore,
): ProviderManagementSnapshot {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )
  useEffect(() => {
    void store.ensureLoaded()
  }, [store])
  return snapshot
}
