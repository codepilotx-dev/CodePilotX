import type { DesktopPermissionConfig } from '../../../../shared/types.js'
import {
  installSandboxRuntime,
  loadSandboxRuntimeStatus,
  repairSandboxRuntime,
  type SandboxRuntimeStatus,
} from '../../../shared/sandboxRuntime.js'

export type SandboxPreflightResult =
  | { ready: true }
  | { ready: false; message: string }

export type SandboxPreflightDependencies = {
  loadStatus: () => Promise<SandboxRuntimeStatus>
  install: () => Promise<SandboxRuntimeStatus>
  repair: () => Promise<SandboxRuntimeStatus>
  confirm: (message: string) => boolean
}

const DEFAULT_DEPENDENCIES: SandboxPreflightDependencies = {
  loadStatus: loadSandboxRuntimeStatus,
  install: installSandboxRuntime,
  repair: repairSandboxRuntime,
  confirm: message => window.confirm(message),
}

export async function ensureSandboxReady(
  permissionConfig: DesktopPermissionConfig,
  dependencies: SandboxPreflightDependencies = DEFAULT_DEPENDENCIES,
): Promise<SandboxPreflightResult> {
  if (permissionConfig.sandboxMode === 'danger-full-access') {
    return { ready: true }
  }

  try {
    const status = await dependencies.loadStatus()
    if (status.state === 'healthy') return { ready: true }

    if (status.state === 'not-installed') {
      if (
        !dependencies.confirm(
          '首次使用安全沙盒需要安装 CodePilotX SRT。安装过程会请求一次 Windows 管理员权限，是否继续？',
        )
      ) {
        return { ready: false, message: '已取消安装安全沙盒' }
      }
      return completedResult(
        await dependencies.install(),
        'SRT 安装后仍不可用，请打开“设置 → 配置”检查沙盒状态。',
      )
    }

    if (status.state === 'needs-repair' || status.state === 'damaged') {
      if (
        !dependencies.confirm(
          'CodePilotX SRT 安全沙盒需要修复。修复过程会请求 Windows 管理员权限，是否继续？',
        )
      ) {
        return { ready: false, message: '已取消修复安全沙盒' }
      }
      return completedResult(
        await dependencies.repair(),
        'SRT 修复后仍不可用，请打开“设置 → 配置”检查沙盒状态。',
      )
    }

    return {
      ready: false,
      message:
        status.state === 'installing'
          ? 'SRT 安全沙盒正在安装，请稍后重试'
          : status.message || '当前系统不支持 SRT 安全沙盒',
    }
  } catch (error) {
    return {
      ready: false,
      message:
        error instanceof Error && error.message
          ? error.message
          : '无法检查 SRT 安全沙盒状态',
    }
  }
}

function completedResult(
  status: SandboxRuntimeStatus,
  fallback: string,
): SandboxPreflightResult {
  return status.state === 'healthy'
    ? { ready: true }
    : { ready: false, message: status.message || fallback }
}
