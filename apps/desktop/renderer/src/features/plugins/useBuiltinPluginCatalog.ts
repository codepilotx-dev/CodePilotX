import { useCallback, useEffect, useState } from 'react'
import type { DesktopBuiltinPlugin } from '../../../shared/types.js'
import { desktopClient } from '../../services/desktop-client/index.js'

export type BuiltinPluginCatalogState = {
  plugins: DesktopBuiltinPlugin[] | undefined
  error: string | null
  loading: boolean
  refresh: () => void
  setEnabled: (pluginId: string, enabled: boolean) => Promise<DesktopBuiltinPlugin>
}

export function useBuiltinPluginCatalog(): BuiltinPluginCatalogState {
  const [plugins, setPlugins] = useState<DesktopBuiltinPlugin[] | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPlugins(undefined)
    setError(null)
    desktopClient
      .listBuiltinPlugins()
      .then(items => {
        if (!cancelled) setPlugins([...items])
      })
      .catch(cause => {
        if (cancelled) return
        setPlugins([])
        setError(
          cause instanceof Error ? cause.message : '插件状态读取失败。',
        )
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const setEnabled = useCallback(
    async (pluginId: string, enabled: boolean): Promise<DesktopBuiltinPlugin> => {
      const result = await desktopClient.setBuiltinPluginEnabled(pluginId, enabled)
      setPlugins(current => {
        const next = [...(current ?? [])]
        const index = next.findIndex(plugin => plugin.id === result.id)
        if (index >= 0) next[index] = result
        else next.push(result)
        return next
      })
      return result
    },
    [],
  )

  return {
    plugins,
    error,
    loading: plugins === undefined && error === null,
    refresh: () => setReloadKey(current => current + 1),
    setEnabled,
  }
}
