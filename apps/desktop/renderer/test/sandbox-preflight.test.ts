import { describe, expect, test } from 'bun:test'
import type { DesktopPermissionConfig } from '../shared/types'
import type {
  SandboxRuntimeStatus,
} from '../src/shared/sandboxRuntime'
import {
  ensureSandboxReady,
  type SandboxPreflightDependencies,
} from '../src/features/session/composer/sandboxPreflight'

const sandboxed: DesktopPermissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
}

function status(
  state: SandboxRuntimeStatus['state'],
  message = '',
): SandboxRuntimeStatus {
  return {
    state,
    version: state === 'healthy' ? '1.0.0' : null,
    maturity: 'alpha',
    maxConcurrentCommands: 8,
    message,
    canInstall: state === 'not-installed',
    canRepair: state === 'damaged' || state === 'needs-repair',
    canUninstall: state === 'healthy',
  }
}

function dependencies(
  overrides: Partial<SandboxPreflightDependencies> = {},
): SandboxPreflightDependencies {
  return {
    loadStatus: async () => status('healthy'),
    install: async () => status('healthy'),
    repair: async () => status('healthy'),
    confirm: () => true,
    ...overrides,
  }
}

describe('SRT 提交前预检', () => {
  test('完全访问不读取 SRT 状态', async () => {
    let checks = 0
    const result = await ensureSandboxReady(
      { ...sandboxed, sandboxMode: 'danger-full-access' },
      dependencies({
        loadStatus: async () => {
          checks += 1
          return status('not-installed')
        },
      }),
    )

    expect(result).toEqual({ ready: true })
    expect(checks).toBe(0)
  })

  test('未安装时确认后安装，取消时不执行安装', async () => {
    let installs = 0
    const cancelled = await ensureSandboxReady(
      sandboxed,
      dependencies({
        loadStatus: async () => status('not-installed'),
        confirm: () => false,
        install: async () => {
          installs += 1
          return status('healthy')
        },
      }),
    )
    expect(cancelled.ready).toBe(false)
    expect(installs).toBe(0)

    const installed = await ensureSandboxReady(
      sandboxed,
      dependencies({
        loadStatus: async () => status('not-installed'),
        install: async () => {
          installs += 1
          return status('healthy')
        },
      }),
    )
    expect(installed).toEqual({ ready: true })
    expect(installs).toBe(1)
  })

  test('损坏或需修复时确认后修复，并保留失败信息', async () => {
    let repairs = 0
    let confirmation = ''
    const repaired = await ensureSandboxReady(
      sandboxed,
      dependencies({
        loadStatus: async () => status('needs-repair'),
        confirm: message => {
          confirmation = message
          return true
        },
        repair: async () => {
          repairs += 1
          return status('healthy')
        },
      }),
    )
    expect(repaired).toEqual({ ready: true })
    expect(repairs).toBe(1)
    expect(confirmation).toContain('WFP 回环端口范围更新为 60080–60095')

    const failed = await ensureSandboxReady(
      sandboxed,
      dependencies({
        loadStatus: async () => status('damaged'),
        repair: async () => {
          throw new Error('用户取消了 UAC')
        },
      }),
    )
    expect(failed).toEqual({ ready: false, message: '用户取消了 UAC' })
  })
})
