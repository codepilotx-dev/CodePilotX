import { describe, expect, test } from 'bun:test'
import {
  resolveModelSetupGate,
} from '../src/features/models/setup/RequireConfiguredModel.js'

describe('first-use model setup gate', () => {
  test('waits for provider state before deciding where to route', () => {
    expect(resolveModelSetupGate({
      loaded: false,
      configurationError: null,
      currentProviderState: null,
    })).toBe('loading')
  })

  test('distinguishes Agent recovery from a genuine unconfigured state', () => {
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: '供应商配置状态暂时无法读取',
      currentProviderState: null,
    })).toBe('recovery')
    // 没有 Provider 状态快照时不可信，必须进入恢复态，不能误判为待配置。
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: null,
      currentProviderState: null,
    })).toBe('recovery')
    // 有状态快照但未配置模型：真正的首次配置。
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: null,
      currentProviderState: {
        modelConfigured: false,
      } as never,
    })).toBe('setup')
  })

  test('configuration error never lets a stale configured state pass', () => {
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: '供应商配置状态暂时无法读取',
      currentProviderState: {
        modelConfigured: true,
      } as never,
    })).toBe('recovery')
  })

  test('plain usage errors do not gate the workbench', () => {
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: null,
      currentProviderState: {
        modelConfigured: true,
      } as never,
    })).toBe('workbench')
  })

  test('opens the workbench only for a configured model', () => {
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: null,
      currentProviderState: {
        modelConfigured: false,
      } as never,
    })).toBe('setup')
    expect(resolveModelSetupGate({
      loaded: true,
      configurationError: null,
      currentProviderState: {
        modelConfigured: true,
      } as never,
    })).toBe('workbench')
  })
})
