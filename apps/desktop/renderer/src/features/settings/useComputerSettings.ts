import { useEffect, useState } from 'react'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { desktopClient } from '../../services/desktop-client/index.js'

const emptyState: RpcResult<'computer/state'> = {
  enabled: false,
  available: false,
  ownerThreadId: null,
  ownerTurnId: null,
  targetName: null,
  busy: false,
  permissions: [],
}

export function useComputerSettings() {
  const [state, setState] = useState<RpcResult<'computer/state'>>(emptyState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [apps, setApps] = useState<RpcResult<'computer/apps'>['apps']>([])

  useEffect(() => {
    let disposed = false
    void desktopClient
      .getComputerState()
      .then((next) => {
        if (!disposed) setState(next)
      })
      .catch(() => {
        if (!disposed) setError('电脑控制状态暂时不可用')
      })
    const dispose = desktopClient.onComputerChanged((next) => setState(next))
    return () => {
      disposed = true
      dispose()
    }
  }, [])

  async function update(
    input: Parameters<typeof desktopClient.configureComputer>[0],
  ): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setState(await desktopClient.configureComputer(input))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '电脑控制设置未保存')
    } finally {
      setBusy(false)
    }
  }

  const sessionAppCount = state.permissions.filter(
    (permission) => permission.decision === 'session',
  ).length
  const applications = new Map(state.permissions.map((entry) => [entry.appId, entry]))
  for (const app of apps) {
    if (!applications.has(app.appId)) applications.set(app.appId, { ...app, decision: 'session' })
  }

  async function discover(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setApps((await desktopClient.discoverComputerApps()).apps)
    } catch {
      setError('应用发现失败，请确认没有聊天占用电脑且原生运行时已就绪')
    } finally {
      setBusy(false)
    }
  }
  async function clear(): Promise<void> {
    for (const permission of state.permissions) {
      await update({ appId: permission.appId, decision: 'remove' })
    }
  }
  return { state, busy, error, applications, sessionAppCount, update, discover, clear }
}
