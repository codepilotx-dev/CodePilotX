import type { DesktopThinkingMode } from '../../../../shared/types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

export type SessionModelSelection = {
  providerID: string
  model: string
  thinkingMode: DesktopThinkingMode
  variant?: string
}
type SelectionState = {
  selection: SessionModelSelection | null
  loading: boolean
  error: string | null
}
const empty: SelectionState = { selection: null, loading: true, error: null }
const states = new Map<string | null, SelectionState>()
const pending = new Map<string | null, Promise<SessionModelSelection>>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())

export const sessionModelSelections = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot(id: string | null): SelectionState {
    return states.get(id) ?? empty
  },
  set(id: string | null, selection: SessionModelSelection) {
    pending.delete(id)
    const { providerID, model, thinkingMode, variant } = selection
    states.set(id, { selection: { providerID, model, thinkingMode, ...(variant ? { variant } : {}) }, loading: false, error: null })
    emit()
  },
  delete(id: string | null) {
    pending.delete(id)
    states.delete(id)
    emit()
  },
  async load(id: string | null): Promise<SessionModelSelection> {
    const existing = states.get(id)?.selection
    if (existing) return { ...existing }
    const request = pending.get(id)
    const operation = request ?? (async () => {
      const snapshot = id ? await desktopClient.getSession(id) : null
      if (id && !snapshot) throw new Error('会话模型加载失败，请重试')
      const history = snapshot?.settings
      if (history?.providerID && history.model) {
        return {
          providerID: history.providerID, model: history.model,
          thinkingMode: history.thinkingMode ?? 'default', variant: history.variant,
        }
      }
      const defaults = await desktopClient.getModelProviderState()
      return {
        providerID: defaults.selectedProviderID, model: defaults.modelConfigured ? defaults.model : '',
        thinkingMode: defaults.variant === 'enabled' ? 'enabled' as const
          : defaults.variant === 'adaptive' ? 'adaptive' as const
          : defaults.variant === 'disabled' ? 'disabled' as const : 'default' as const,
        ...(defaults.variant ? { variant: defaults.variant } : {}),
      }
    })()
    if (!request) {
      states.set(id, empty)
      pending.set(id, operation)
      emit()
    }
    try {
      const selection = await operation
      if (pending.get(id) === operation) this.set(id, selection)
      const selected = states.get(id)?.selection
      if (!selected) throw new Error('会话模型加载已取消')
      return { ...selected }
    } catch (error) {
      const selected = states.get(id)?.selection
      if (selected) return { ...selected }
      if (pending.get(id) === operation) {
        pending.delete(id)
        states.set(id, { selection: null, loading: false,
          error: error instanceof Error ? error.message : String(error) })
        emit()
      }
      throw error
    }
  },
}
