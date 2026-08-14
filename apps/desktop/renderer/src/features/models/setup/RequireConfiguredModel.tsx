import type React from 'react'
import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { Button } from '../../../components/ui/Button.js'
import type { ProviderManagementSnapshot } from '../../provider-management/types.js'
import { providerManagementStore } from '../../provider-management/providerManagementStore.js'
import { useProviderManagementSnapshot } from '../../provider-management/useProviderManagementSnapshot.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'

export type ModelSetupGateDecision =
  | 'loading'
  | 'recovery'
  | 'setup'
  | 'workbench'

export function resolveModelSetupGate(
  snapshot: Pick<
    ProviderManagementSnapshot,
    'loaded' | 'configurationError' | 'currentProviderState'
  >,
  settings: {
    settingsLoaded: boolean
    firstUseSetupCompleted: 0 | 1 | undefined
  },
): ModelSetupGateDecision {
  if (!snapshot.loaded || !settings.settingsLoaded) return 'loading'
  if (snapshot.configurationError || !snapshot.currentProviderState) return 'recovery'
  if (settings.firstUseSetupCompleted === 0) return 'setup'
  if (settings.firstUseSetupCompleted === 1) return 'workbench'
  return snapshot.currentProviderState.modelConfigured ? 'workbench' : 'setup'
}

export function RequireConfiguredModel(): React.ReactNode {
  const snapshot = useProviderManagementSnapshot()
  const settings = useDesktopSettings()
  const decision = resolveModelSetupGate(snapshot, settings)

  useEffect(() => {
    if (
      !settings.settingsLoaded
      || !snapshot.loaded
      || snapshot.configurationError
      || !snapshot.currentProviderState
      || settings.firstUseSetupCompleted !== undefined
    ) return
    const inferred = snapshot.currentProviderState.modelConfigured ? 1 : 0
    void settings.saveFirstUseSetupCompleted(inferred).catch(() => undefined)
  }, [
    settings.firstUseSetupCompleted,
    settings.saveFirstUseSetupCompleted,
    settings.settingsLoaded,
    snapshot.configurationError,
    snapshot.currentProviderState,
    snapshot.loaded,
  ])

  if (decision === 'loading') {
    return <SetupBootState />
  }
  if (decision === 'recovery') {
    return (
      <SetupRecoveryState
        message={snapshot.configurationError ?? snapshot.error}
        onRetry={() => void providerManagementStore.refresh()}
      />
    )
  }
  if (decision === 'setup') {
    return <Navigate replace to="/setup" />
  }
  return <Outlet />
}

export function SetupBootState(): React.ReactNode {
  return (
    <main
      className="tw:grid tw:h-screen tw:w-full tw:place-content-center tw:justify-items-center tw:gap-4 tw:bg-app-canvas tw:text-app-text-soft"
      aria-busy="true"
      aria-label="正在检查模型配置"
    >
      <span aria-hidden className="ui-button-spinner" />
      <p className="tw:m-0">正在准备 CodePilotX…</p>
    </main>
  )
}

export function SetupRecoveryState({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}): React.ReactNode {
  return (
    <main className="tw:grid tw:h-screen tw:w-full tw:place-content-center tw:justify-items-center tw:gap-5 tw:bg-app-canvas tw:p-8 tw:text-center">
      <div className="tw:max-w-md">
        <h1 className="tw:m-0 tw:text-xl tw:font-medium tw:text-app-text">本地 Agent 暂时不可用</h1>
        <p className="tw:mt-2 tw:mb-0 tw:text-app-text-soft">{message || '无法读取供应商配置。请确认 Agent 已启动，然后重试。'}</p>
      </div>
      <Button color="secondary" onClick={onRetry}>重试</Button>
    </main>
  )
}
