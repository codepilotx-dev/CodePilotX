import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type {
  DesktopApiKeySummary,
  DesktopIntegration,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { fullErrorMessage } from '../../utils/errors.js'

type Options = {
  onInitialProviderState: (state: DesktopModelProviderState) => void
  onError: (message: string) => void
}

export type ModelCenterController = {
  providers: DesktopModelProviderSummary[]
  providerState: DesktopModelProviderState | null
  integrations: DesktopIntegration[]
  apiKeys: DesktopApiKeySummary[]
  setProviderState: Dispatch<SetStateAction<DesktopModelProviderState | null>>
  setApiKeys: Dispatch<SetStateAction<DesktopApiKeySummary[]>>
  refreshProviderContext: () => Promise<{
    integrations: DesktopIntegration[]
    providerState: DesktopModelProviderState
  }>
}

export function useModelCenterController({
  onInitialProviderState,
  onError,
}: Options): ModelCenterController {
  const [providers, setProviders] = useState<DesktopModelProviderSummary[]>([])
  const [providerState, setProviderState] = useState<DesktopModelProviderState | null>(null)
  const [integrations, setIntegrations] = useState<DesktopIntegration[]>([])
  const [apiKeys, setApiKeys] = useState<DesktopApiKeySummary[]>([])
  const initialStateHandler = useRef(onInitialProviderState)
  const errorHandler = useRef(onError)

  useEffect(() => {
    initialStateHandler.current = onInitialProviderState
    errorHandler.current = onError
  }, [onError, onInitialProviderState])

  useEffect(() => {
    let mounted = true
    void Promise.all([
      desktopClient.listModelProviders(),
      desktopClient.getModelProviderState(),
      desktopClient.listIntegrations(),
      desktopClient.listApiKeys(),
    ]).then(([nextProviders, nextState, nextIntegrations, nextKeys]) => {
      if (!mounted) return
      setProviders(nextProviders)
      setProviderState(nextState)
      setIntegrations(nextIntegrations)
      setApiKeys(nextKeys)
      initialStateHandler.current(nextState)
    }).catch(error => {
      if (!mounted) return
      errorHandler.current(fullErrorMessage(error))
    })
    return () => {
      mounted = false
    }
  }, [])

  const refreshProviderContext = useCallback(async () => {
    const [nextIntegrations, nextState] = await Promise.all([
      desktopClient.listIntegrations(),
      desktopClient.getModelProviderState(),
    ])
    setIntegrations(nextIntegrations)
    setProviderState(nextState)
    return { integrations: nextIntegrations, providerState: nextState }
  }, [])

  return {
    providers,
    providerState,
    integrations,
    apiKeys,
    setProviderState,
    setApiKeys,
    refreshProviderContext,
  }
}
