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
  maturity: 'alpha'
  maxConcurrentCommands: number
  message: string
  canInstall: boolean
  canRepair: boolean
  canUninstall: boolean
}

export const SANDBOX_RUNTIME_STATUS_UNAVAILABLE: SandboxRuntimeStatus = {
  state: 'unavailable',
  version: null,
  maturity: 'alpha',
  maxConcurrentCommands: 8,
  message: '桌面端尚未提供 Sandbox runtime 状态接口。',
  canInstall: false,
  canRepair: false,
  canUninstall: false,
}

type BackendSandboxStatus = {
  state: 'unsupported' | 'not-installed' | 'installing' | 'available' | 'damaged' | 'repair-required'
  runtimeVersion: string
  maturity: 'alpha'
  maxConcurrentCommands: number
  error: string | null
  operations: {
    canInstall: boolean
    canRepair: boolean
    canUninstall: boolean
  }
}

const rpc = createAgentRpcClient({})
const sandboxClientInstanceId = crypto.randomUUID()
let sandboxRpcReady: Promise<void> | null = null

function ensureSandboxRpcReady(): Promise<void> {
  sandboxRpcReady ??= (async () => {
    const initialized = await rpc.call('initialize', {
      clientInfo: {
        name: 'codepilotx-desktop-sandbox-settings',
        version: '0.2.0',
        platform:
          typeof navigator === 'undefined' ? 'desktop' : navigator.platform,
        instanceId: sandboxClientInstanceId,
      },
      protocols: ['thread-rpc-v4'],
      capabilities: ['rpc.typed.v1', 'sandbox.management.v1'],
      interactionDelivery: 'observe',
    })
    rpc.setConnectionId(initialized.connectionId)
    await rpc.initialized({
      protocol: 'thread-rpc-v4',
      clientInstanceId: sandboxClientInstanceId,
    })
  })().catch(error => {
    sandboxRpcReady = null
    throw error
  })
  return sandboxRpcReady
}

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
    maturity: status.maturity,
    maxConcurrentCommands: status.maxConcurrentCommands,
    message: status.error ?? (state === 'healthy' ? 'SRT 沙箱可用。' : state === 'not-installed' ? 'SRT 沙箱尚未安装。' : 'SRT 沙箱需要检查或修复。'),
    canInstall: status.operations.canInstall,
    canRepair: status.operations.canRepair,
    canUninstall: status.operations.canUninstall,
  }
}

export async function loadSandboxRuntimeStatus(): Promise<SandboxRuntimeStatus> {
  await ensureSandboxRpcReady()
  const response = await rpc.call('sandbox/status', {})
  return normalizeStatus(response.sandbox)
}

export async function refreshSandboxRuntimeStatus(): Promise<SandboxRuntimeStatus> {
  await ensureSandboxRpcReady()
  const response = await rpc.call('sandbox/refresh', {})
  return normalizeStatus(response.sandbox)
}

export async function installSandboxRuntime(): Promise<SandboxRuntimeStatus> {
  await ensureSandboxRpcReady()
  const response = await rpc.call(
    'sandbox/install',
    { operationId: crypto.randomUUID() },
  )
  return normalizeStatus(response.sandbox)
}

export async function repairSandboxRuntime(): Promise<SandboxRuntimeStatus> {
  await ensureSandboxRpcReady()
  const response = await rpc.call(
    'sandbox/repair',
    { operationId: crypto.randomUUID() },
  )
  return normalizeStatus(response.sandbox)
}

export async function uninstallSandboxRuntime(): Promise<SandboxRuntimeStatus> {
  await ensureSandboxRpcReady()
  const response = await rpc.call(
    'sandbox/uninstall',
    { confirm: true, operationId: crypto.randomUUID() },
  )
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
