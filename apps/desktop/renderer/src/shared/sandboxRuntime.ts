import { createAgentRpcClient } from '../services/agentRpcClient.js'

export type SandboxRuntimeState =
  | 'unavailable'
  | 'not-installed'
  | 'installing'
  | 'healthy'
  | 'needs-repair'
  | 'damaged'

export type SandboxRuntimeStatus = {
  state: SandboxRuntimeState
  version: string | null
  message: string
  canInstall: boolean
  canRepair: boolean
}

export const SANDBOX_RUNTIME_STATUS_UNAVAILABLE: SandboxRuntimeStatus = {
  state: 'unavailable',
  version: null,
  message: '桌面端尚未提供 Sandbox runtime 状态接口。',
  canInstall: false,
  canRepair: false,
}

type BackendSandboxStatus = {
  state: 'unsupported' | 'not-installed' | 'installing' | 'available' | 'damaged' | 'repair-required'
  runtimeVersion: string
  error: string | null
}

const rpc = createAgentRpcClient({})

function normalizeStatus(status: BackendSandboxStatus): SandboxRuntimeStatus {
  const state: SandboxRuntimeState = status.state === 'available'
    ? 'healthy'
    : status.state === 'repair-required'
      ? 'needs-repair'
      : status.state === 'unsupported'
        ? 'unavailable'
        : status.state
  return {
    state,
    version: status.runtimeVersion,
    message: status.error ?? (state === 'healthy' ? 'SRT 沙箱可用。' : state === 'not-installed' ? 'SRT 沙箱尚未安装。' : 'SRT 沙箱需要检查或修复。'),
    canInstall: state === 'not-installed',
    canRepair: state === 'damaged' || state === 'needs-repair',
  }
}

export async function loadSandboxRuntimeStatus(): Promise<SandboxRuntimeStatus> {
  const response = await rpc.call<{ sandbox: BackendSandboxStatus }>('sandbox/status')
  return normalizeStatus(response.sandbox)
}

export async function installSandboxRuntime(): Promise<SandboxRuntimeStatus> {
  const response = await rpc.call<{ sandbox: BackendSandboxStatus }>('sandbox/install')
  return normalizeStatus(response.sandbox)
}

export async function repairSandboxRuntime(): Promise<SandboxRuntimeStatus> {
  const response = await rpc.call<{ sandbox: BackendSandboxStatus }>('sandbox/repair')
  return normalizeStatus(response.sandbox)
}

export async function uninstallSandboxRuntime(): Promise<SandboxRuntimeStatus> {
  const response = await rpc.call<{ sandbox: BackendSandboxStatus }>('sandbox/uninstall', { confirm: true })
  return normalizeStatus(response.sandbox)
}

export function sandboxRuntimeStateLabel(state: SandboxRuntimeState): string {
  switch (state) {
    case 'healthy':
      return '健康'
    case 'installing':
      return '安装中'
    case 'not-installed':
      return '未安装'
    case 'needs-repair':
      return '需要修复'
    case 'damaged':
      return '损坏'
    case 'unavailable':
      return '不可用'
  }
}
