import { useState } from 'react'
import type {
  DesktopModelProviderState,
  DesktopModelProviderSummary,
} from '../../../shared/types.js'
import { useModelCatalogLoading } from '../../hooks/useModelCatalogLoading.js'

/**
 * Owns the mutable provider catalog state used by the workbench.
 *
 * Provider synchronization remains in DesktopLayout for now because its effects
 * are ordered with active-session model reconciliation and settings persistence.
 */
export function useModelProviderController() {
  const [providerState, setProviderState] =
    useState<DesktopModelProviderState | null>(null)
  const [modelProviders, setModelProviders] = useState<
    DesktopModelProviderSummary[]
  >([])
  const modelCatalogLoading = useModelCatalogLoading()

  return {
    providerState,
    setProviderState,
    modelProviders,
    setModelProviders,
    modelCatalogLoading,
  }
}
