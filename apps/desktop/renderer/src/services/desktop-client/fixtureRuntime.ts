// Small stateless Browser Mock fallbacks shared with the Agent client. Keep
// these separate from fixtureShared.ts so Electron startup does not parse the
// much larger mock thread-history projection.
import type {
  DesktopAuthStatus,
  DesktopPermissionMode,
  DesktopRuntimeStatus,
} from '../../../shared/types.js'
import type { PermissionConfig } from '@codepilotx/shared/thread'
import { permissionModeFromPermissionConfig } from '../agentThreadAdapter.js'

export function permissionModeFromDesktopConfig(
  config: PermissionConfig,
): DesktopPermissionMode {
  return permissionModeFromPermissionConfig(config)
}

export function mockRuntimeStatus(): DesktopRuntimeStatus {
  return {
    runtimeKind: 'rust-sidecar',
    runtimePreference: 'auto',
    runtimeSelectionSource: 'default',
    agentExecutablePath: '',
    agentExecutableExists: false,
    configDirectoryPath: '',
    toolchainEnabled: true,
    toolchainRoot: null,
    managedToolchainRoot: '',
    packagedToolchainRoot: '',
    toolchainPathEntries: [],
    toolchainBinaries: [],
  }
}

export function mockAuthStatus(): DesktopAuthStatus {
  return {
    authenticated: false,
    method: 'none',
    email: null,
    organizationName: null,
  }
}

export async function bridgeWindowMaximized(): Promise<boolean> {
  return (await window.codePilotXDesktop?.isMaximized()) ?? false
}
