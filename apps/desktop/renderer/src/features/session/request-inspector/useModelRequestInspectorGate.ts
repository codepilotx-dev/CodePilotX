import { useCallback, useEffect, useState } from 'react'
import { CONFIG_UPDATED_EVENT } from '../../../services/desktop-client/agent-session-client.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { modelRequestSnapshotsEnabledFromConfig } from './requestInspectorModel.js'

/**
 * 请求检查器入口门禁：仅当用户层
 * `diagnostics.model_request_snapshots.enabled === true` 且 Agent 协商了
 * `runtime.request-snapshots.v1` 时才显示 launcher；配置变化实时刷新。
 */
export function useModelRequestInspectorGate(): {
  enabled: boolean
  capabilityAvailable: boolean
  loading: boolean
} {
  const [enabled, setEnabled] = useState(false)
  const [capabilityAvailable, setCapabilityAvailable] = useState(false)
  const [configLoading, setConfigLoading] = useState(true)
  const [capabilityLoading, setCapabilityLoading] = useState(true)

  const refreshEnabled = useCallback((mountedRef?: { current: boolean }) => {
    setConfigLoading(true)
    void desktopClient.readConfig({ includeLayers: true })
      .then(read => {
        if (mountedRef && !mountedRef.current) return
        const userLayer = read.layers?.find(layer => layer.kind === 'user')
        setEnabled(modelRequestSnapshotsEnabledFromConfig(userLayer?.config))
      })
      .catch(() => {
        if (mountedRef && !mountedRef.current) return
        setEnabled(false)
      })
      .finally(() => {
        if (!mountedRef || mountedRef.current) {
          setConfigLoading(false)
        }
      })
  }, [])

  useEffect(() => {
    const mountedRef = { current: true }
    refreshEnabled(mountedRef)
    setCapabilityLoading(true)
    void desktopClient.getRuntimeCapabilities()
      .then(capabilities => {
        if (mountedRef.current) {
          setCapabilityAvailable(
            capabilities.includes('runtime.request-snapshots.v1'),
          )
        }
      })
      .catch(() => {
        if (mountedRef.current) setCapabilityAvailable(false)
      })
      .finally(() => {
        if (mountedRef.current) setCapabilityLoading(false)
      })
    const onConfigUpdated = () => refreshEnabled(mountedRef)
    window.addEventListener(CONFIG_UPDATED_EVENT, onConfigUpdated)
    return () => {
      mountedRef.current = false
      window.removeEventListener(CONFIG_UPDATED_EVENT, onConfigUpdated)
    }
  }, [refreshEnabled])

  return { enabled, capabilityAvailable, loading: configLoading || capabilityLoading }
}
