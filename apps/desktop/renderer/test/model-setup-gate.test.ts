import { describe, expect, test } from 'bun:test'
import {
  resolveModelSetupGate,
} from '../src/features/models/setup/RequireConfiguredModel.js'

const settings = (
  firstUseSetupCompleted: 0 | 1 | undefined,
  settingsLoaded = true,
) => ({ firstUseSetupCompleted, settingsLoaded })

const providerSnapshot = (modelConfigured: boolean) => ({
  loaded: true,
  configurationError: null,
  currentProviderState: { modelConfigured } as never,
})

describe('first-use model setup gate', () => {
  test('waits for both settings and provider state before routing', () => {
    expect(resolveModelSetupGate({
      loaded: false,
      configurationError: null,
      currentProviderState: null,
    }, settings(undefined))).toBe('loading')
    expect(resolveModelSetupGate(
      providerSnapshot(true),
      settings(undefined, false),
    )).toBe('loading')
  })

  test('keeps Agent configuration failures in recovery', () => {
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: '供应商配置状态暂时无法读取',
      currentProviderState: { modelConfigured: true } as never,
    }, settings(1))).toBe('recovery')
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: null,
      currentProviderState: null,
    }, settings(0))).toBe('recovery')
  })

  test('explicit zero always opens the full setup guide', () => {
    expect(resolveModelSetupGate(
      providerSnapshot(false),
      settings(0),
    )).toBe('setup')
    expect(resolveModelSetupGate(
      providerSnapshot(true),
      settings(0),
    )).toBe('setup')
  })

  test('explicit one always opens the workbench', () => {
    expect(resolveModelSetupGate(
      providerSnapshot(false),
      settings(1),
    )).toBe('workbench')
    expect(resolveModelSetupGate(
      providerSnapshot(true),
      settings(1),
    )).toBe('workbench')
  })

  test('legacy settings infer the one-time value from the configured model', () => {
    expect(resolveModelSetupGate(
      providerSnapshot(false),
      settings(undefined),
    )).toBe('setup')
    expect(resolveModelSetupGate(
      providerSnapshot(true),
      settings(undefined),
    )).toBe('workbench')
  })
})
