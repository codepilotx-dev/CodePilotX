import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopModelMetadata,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { isExecutableDesktopProvider } from '../../services/desktop-client/provider-adapters.js'
import { useModelCatalogLoading, withModelCatalogLoading } from '../../hooks/useModelCatalogLoading.js'
import { buildModelPresets, resolveModelPresetId } from '../../modelPresets.js'
import type { SessionListItem } from '../../uiTypes.js'
import type { UseDesktopRuntimeSettingsResult } from '../settings/useDesktopSettings.js'

export function useModelProviderController({
  settings,
  activeSessionItem,
  sessionId,
  hasMessages,
  setErrorMessage,
  setNoticeMessage,
}: {
  settings: UseDesktopRuntimeSettingsResult
  activeSessionItem: SessionListItem | null | undefined
  sessionId: string | null
  hasMessages: boolean
  setErrorMessage: (message: string) => void
  setNoticeMessage: (message: string) => void
}) {
  const {
    values: { model, providerID, selectedModelPreset, thinkingMode },
    setProviderID, setProviderBaseURL, setSelectedModelPreset, setModel,
    setThinkingMode, syncExternalSettingsPatch,
  } = settings
  const [providerState, setProviderState] = useState<DesktopModelProviderState | null>(null)
  const [modelProviders, setModelProviders] = useState<DesktopModelProviderSummary[]>([])
  const modelCatalogLoading = useModelCatalogLoading()
  const modelPresets = useMemo(
    () =>
      buildModelPresets(
        providerState?.models ?? providerState?.provider.defaultModels ?? [],
      ),
    [providerState],
  )
  const syncedSessionModelRef = useRef<string | null>(null)
  const modelRef = useRef(model)
  const providerIDRef = useRef(providerID)
  const selectionRequestIdRef = useRef(0)
  const selectionSaveTailRef = useRef<Promise<unknown>>(Promise.resolve())
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const providerStateRequestIdRef = useRef(0)
  const fetchedModelCatalogKeysRef = useRef<Set<string>>(new Set())
  const pendingModelCatalogKeysRef = useRef<Set<string>>(new Set())
  const openedProviderCatalogsRef = useRef<Set<ModelProviderID>>(new Set())
  useEffect(() => {
    modelRef.current = model
    providerIDRef.current = providerID
  }, [model, providerID])
  const providerModelOptions = useMemo(
    () => {
      const providers = [...modelProviders]
      if (
        providerState &&
        !providers.some(
          provider => provider.providerID === providerState.provider.providerID,
        )
      ) {
        providers.unshift(providerState.provider)
      }
      return providers
        .filter(provider => provider.apiKeyConfigured && isExecutableDesktopProvider(provider))
        .map(provider => {
          const isSelected =
            provider.providerID === providerState?.selectedProviderID
          const models = isSelected
            ? providerState?.models ?? provider.defaultModels
            : provider.defaultModels
          return {
            providerID: provider.providerID,
            displayName: provider.displayName,
            modelPresets: buildModelPresets(models),
            baseURL: provider.baseURL,
          }
        })
    },
    [modelProviders, providerState],
  )
  const selectedProviderID = providerID
  const selectedProviderModelPresets =
    providerModelOptions.find(
      provider => provider.providerID === selectedProviderID,
    )?.modelPresets ?? modelPresets
  const resolvedSelectedModelPreset = resolveModelPresetId(
    model,
    selectedModelPreset,
    selectedProviderModelPresets,
  )
  const selectedProviderSummary =
    modelProviders.find(provider => provider.providerID === selectedProviderID) ??
    (providerState?.provider.providerID === selectedProviderID
      ? providerState.provider
      : undefined)
  const selectedModelMetadata =
    model && selectedProviderSummary?.modelMetadata
      ? selectedProviderSummary.modelMetadata[model]
      : model && providerState?.modelMetadata
        ? providerState.modelMetadata[model]
        : undefined
  const deepSeekThinkingControls = isDeepSeekThinkingModel({
    providerID: selectedProviderID,
    model,
    metadata: selectedModelMetadata,
  })
  const showThinkingOptions =
    deepSeekThinkingControls ||
    selectedProviderSummary?.kind === 'anthropic' ||
    selectedModelMetadata?.reasoning === true
  const selectedModelAvailable = Boolean(
    model
    && selectedProviderSummary
    && isExecutableDesktopProvider(selectedProviderSummary)
    && (
      selectedProviderID === providerState?.selectedProviderID
        ? providerState.models.includes(model)
        : selectedProviderSummary.defaultModels.includes(model)
    ),
  )
  const modelConfigured = selectedProviderSummary?.apiKeyConfigured === true
    && (Boolean(sessionId) || providerState?.modelConfigured === true)
    && selectedModelAvailable

  useEffect(() => {
    const activeModel = activeSessionItem?.model?.trim()
    const activeProviderID = activeSessionItem?.providerID
    // Session history seeds the composer on entry, not after each turn update.
    const syncKey = activeSessionItem?.id ?? null
    if (!syncKey) syncedSessionModelRef.current = null
    if (!activeModel || !syncKey || syncedSessionModelRef.current === syncKey) {
      return
    }
    syncedSessionModelRef.current = syncKey
    modelRef.current = activeModel
    if (activeProviderID) providerIDRef.current = activeProviderID
    syncExternalSettingsPatch({
      ...(activeProviderID ? { providerID: activeProviderID } : {}),
      ...(model !== activeModel ? { model: activeModel } : {}),
    })
    const nextPreset = resolveModelPresetId(
      activeModel,
      undefined,
      selectedProviderModelPresets,
    )
    if (selectedModelPreset !== nextPreset) {
      setSelectedModelPreset(nextPreset)
    }
  }, [
    activeSessionItem?.id,
    activeSessionItem?.model,
    activeSessionItem?.providerID,
    model,
    selectedProviderModelPresets,
    selectedModelPreset,
    setSelectedModelPreset,
    syncExternalSettingsPatch,
  ])

  const refreshProviderState = useCallback(async (): Promise<void> => {
    const requestId = ++providerStateRequestIdRef.current
    try {
      const [next, providers] = await Promise.all([
        desktopClient.getModelProviderState(sessionId ? providerIDRef.current : undefined),
        desktopClient.listModelProviders(),
      ])
      if (requestId !== providerStateRequestIdRef.current) return
      setProviderState(next)
      setModelProviders(providers)
      const activeModel = sessionId ? modelRef.current : null
      const shouldSyncModel = !activeModel && next.model !== modelRef.current
      syncExternalSettingsPatch({
        providerID: next.selectedProviderID,
        providerBaseURL: next.baseURL ?? '',
        ...(activeModel
          ? { model: activeModel }
          : shouldSyncModel
            ? { model: next.model }
            : {}),
      })
      if (
        next.selectedProviderID &&
        next.apiKeyConfigured
      ) {
        const catalogKey = [
          next.selectedProviderID,
          next.apiKeyConfigured ? 'key' : 'no-key',
        ].join('\0')
        if (
          fetchedModelCatalogKeysRef.current.has(catalogKey) ||
          pendingModelCatalogKeysRef.current.has(catalogKey)
        ) {
          return
        }
        pendingModelCatalogKeysRef.current.add(catalogKey)
        void withModelCatalogLoading(() =>
          desktopClient.fetchProviderModels({
            providerID: next.selectedProviderID,
          }),
        )
          .then(result => {
            setProviderState(current => {
              if (current?.selectedProviderID !== next.selectedProviderID) {
                return current
              }
              return {
                ...current,
                models: result.models,
                modelMetadata: {
                  ...current.modelMetadata,
                  ...result.modelMetadata,
                },
                error: result.error,
              }
            })
            fetchedModelCatalogKeysRef.current.add(catalogKey)
          })
          .catch(error =>
            setErrorMessage(
              error instanceof Error ? error.message : String(error),
            ),
          )
          .finally(() => {
            pendingModelCatalogKeysRef.current.delete(catalogKey)
          })
      }
    } catch (error) {
      if (requestId !== providerStateRequestIdRef.current) return
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId, syncExternalSettingsPatch, setErrorMessage])

  useEffect(() => {
    void refreshProviderState()
    const listener = () => {
      openedProviderCatalogsRef.current.clear()
      fetchedModelCatalogKeysRef.current.clear()
      void refreshProviderState()
    }
    window.addEventListener('desktop:model-provider-changed', listener)
    return () => {
      window.removeEventListener('desktop:model-provider-changed', listener)
    }
  }, [refreshProviderState])

  useEffect(() => {
    if (deepSeekThinkingControls && thinkingMode === 'adaptive') {
      setThinkingMode('default')
      return
    }
    if (showThinkingOptions || thinkingMode === 'default') return
    setThinkingMode('default')
  }, [
    deepSeekThinkingControls,
    showThinkingOptions,
    thinkingMode,
    setThinkingMode,
  ])

  const handleProviderModelChange = useCallback(
    (providerID: ModelProviderID, nextPresetId: string): void => {
      const providerOption = providerModelOptions.find(
        provider => provider.providerID === providerID,
      )
      if (!providerOption) return

      const providerSummary =
        modelProviders.find(provider => provider.providerID === providerID) ??
        (providerState?.provider.providerID === providerID
          ? providerState.provider
          : undefined)
      const baseURL =
        providerState?.selectedProviderID === providerID
          ? providerState.baseURL
          : providerSummary?.baseURL

      const preset = providerOption.modelPresets.find(
        item => item.id === nextPresetId,
      )
      if (!preset) return
      const requestId = ++selectionRequestIdRef.current
      ++providerStateRequestIdRef.current
      modelRef.current = preset.value
      providerIDRef.current = providerID
      setProviderID(providerID)
      setProviderBaseURL(baseURL ?? '')
      setSelectedModelPreset(nextPresetId)
      setModel(preset.value)
      if (sessionId && hasMessages) {
        setNoticeMessage('在对话过程中切换模型会降低性能表现')
      }
      const operation = selectionSaveTailRef.current
        .catch(() => undefined)
        .then(() => desktopClient.saveModelProvider({ providerID, id: preset.value }))
      selectionSaveTailRef.current = operation
      void operation
        .then(next => {
          if (requestId !== selectionRequestIdRef.current || sessionIdRef.current !== sessionId) return
          ++providerStateRequestIdRef.current
          setProviderState(next)
          setProviderID(next.selectedProviderID)
          setProviderBaseURL(next.baseURL ?? '')
          setModel(next.model)
        })
        .catch(error => {
          if (requestId !== selectionRequestIdRef.current || sessionIdRef.current !== sessionId) return
          setErrorMessage(error instanceof Error ? error.message : String(error))
        })
    },
    [
      modelProviders,
      hasMessages,
      providerModelOptions,
      providerState,
      sessionId,
      setModel,
      setProviderBaseURL,
      setProviderID,
      setSelectedModelPreset,
      setErrorMessage,
      setNoticeMessage,
    ],
  )

  const handleProviderOpen = useCallback(
    (providerID: ModelProviderID): void => {
      if (openedProviderCatalogsRef.current.has(providerID)) return
      openedProviderCatalogsRef.current.add(providerID)
      void desktopClient.fetchProviderModels({ providerID, all: true })
        .then(result => {
          setModelProviders(current => current.map(provider =>
            provider.providerID === providerID
              ? {
                  ...provider,
                  defaultModels: result.models,
                  modelMetadata: {
                    ...provider.modelMetadata,
                    ...result.modelMetadata,
                  },
                }
              : provider,
          ))
          setProviderState(current => current?.selectedProviderID === providerID
            ? {
                ...current,
                models: result.models,
                modelMetadata: {
                  ...current.modelMetadata,
                  ...result.modelMetadata,
                },
                error: result.error,
              }
            : current)
        })
        .catch(error => {
          openedProviderCatalogsRef.current.delete(providerID)
          setErrorMessage(error instanceof Error ? error.message : String(error))
        })
    },
    [setModelProviders, setProviderState],
  )

  const handleProviderSearch = useCallback(
    (() => {
      const generations = new Map<string, number>();
      return (providerID: ModelProviderID, query: string): void => {
        const generation = (generations.get(providerID) ?? 0) + 1;
        generations.set(providerID, generation);
        void desktopClient.fetchProviderModels({ providerID, query, limit: 100 })
          .then(result => {
            if (generations.get(providerID) !== generation) return;
            setModelProviders(current => current.map(provider =>
              provider.providerID === providerID
                ? {
                    ...provider,
                    defaultModels: result.models,
                    modelMetadata: result.modelMetadata,
                  }
                : provider,
            ));
          })
          .catch(error => {
            if (generations.get(providerID) !== generation) return;
            setErrorMessage(error instanceof Error ? error.message : String(error));
          });
      };
    })(),
    [setModelProviders],
  )

  return {
    providerState, modelProviders, modelCatalogLoading, modelPresets,
    selectedProviderID, selectedProviderModelPresets, resolvedSelectedModelPreset,
    selectedModelMetadata, deepSeekThinkingControls, showThinkingOptions,
    modelConfigured, providerModelOptions,
    handleProviderModelChange, handleProviderOpen, handleProviderSearch,
  }
}

export function isDeepSeekThinkingModel({
  providerID,
  model,
  metadata,
}: {
  providerID?: ModelProviderID
  model: string
  metadata?: DesktopModelMetadata
}): boolean {
  if (providerID === 'deepseek') {
    return true
  }
  if (providerID !== 'openrouter') {
    return false
  }
  return model.toLowerCase().includes('deepseek') && metadata?.reasoning === true
}
