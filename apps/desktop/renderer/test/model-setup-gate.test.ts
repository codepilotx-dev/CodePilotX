import { describe, expect, test } from 'bun:test'
import {
  resolveModelSetupGate,
} from '../src/features/models/setup/RequireConfiguredModel.js'

describe('first-use model setup gate', () => {
  test('waits for provider state before deciding where to route', () => {
    expect(resolveModelSetupGate({
      loaded: false,
      error: null,
      currentProviderState: null,
    })).toBe('loading')
  })

  test('distinguishes Agent recovery from a genuine unconfigured state', () => {
    expect(resolveModelSetupGate({
      loaded: true,
      error: 'Agent unavailable',
      currentProviderState: null,
    })).toBe('recovery')
    expect(resolveModelSetupGate({
      loaded: true,
      error: null,
      currentProviderState: null,
    })).toBe('setup')
  })

  test('opens the workbench only for a configured model', () => {
    expect(resolveModelSetupGate({
      loaded: true,
      error: null,
      currentProviderState: {
        modelConfigured: false,
      } as never,
    })).toBe('setup')
    expect(resolveModelSetupGate({
      loaded: true,
      error: null,
      currentProviderState: {
        modelConfigured: true,
      } as never,
    })).toBe('workbench')
  })
})
