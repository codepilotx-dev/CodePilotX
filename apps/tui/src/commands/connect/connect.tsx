import * as React from 'react'
import TextInput from '../../components/TextInput.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Box, Text } from '../../ink.js'
import { useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  type ModelProviderID,
  type ProviderConfig,
  fetchProviderModels,
  getProviderDisplayName,
  listProviderConfigs,
  saveProviderApiKey,
  saveSelectedProvider,
} from '../../utils/model/providerConfig.js'

type Step = 'provider' | 'baseURL' | 'apiKey' | 'loadingModels' | 'model'

function ConnectProvider({
  onDone,
}: {
  onDone: (result?: string) => void
}): React.ReactNode {
  const setAppState = useSetAppState()
  const [step, setStep] = React.useState<Step>('provider')
  const [providers, setProviders] = React.useState<ProviderConfig[]>([])
  const [providerID, setProviderID] = React.useState<ModelProviderID>('')
  const [baseURL, setBaseURL] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [modelInput, setModelInput] = React.useState('')
  const [availableModels, setAvailableModels] = React.useState<string[] | null>(null)
  const [modelLoadError, setModelLoadError] = React.useState<string | null>(null)
  const [cursorOffset, setCursorOffset] = React.useState(0)

  const provider = providers.find(item => item.providerID === providerID)

  React.useEffect(() => {
    let mounted = true
    void listProviderConfigs()
      .then(nextProviders => {
        if (!mounted) return
        setProviders(nextProviders)
        if (!nextProviders.some(item => item.providerID === providerID)) {
          setProviderID(nextProviders[0]?.providerID ?? '')
        }
      })
      .catch(error => {
        if (!mounted) return
        onDone(error instanceof Error ? error.message : String(error))
      })
    return () => {
      mounted = false
    }
  }, [onDone, providerID])

  function save(modelID: string): void {
    const trimmedModel = modelID.trim()
    if (!trimmedModel) {
      onDone('Model ID is required.')
      return
    }

    if (apiKey.trim()) {
      const result = saveProviderApiKey(providerID, apiKey)
      if (!result.success) {
        onDone(result.warning ?? 'Failed to save provider API key.')
        return
      }
    }

    saveSelectedProvider({
      providerID,
      modelID: trimmedModel,
    })
    setAppState(prev => ({
      ...prev,
      mainLoopModel: trimmedModel,
      mainLoopModelForSession: null,
    }))
    onDone(`Connected ${getProviderDisplayName(providerID)} and set model to ${providerID}/${trimmedModel}`)
  }

  function loadModels(nextApiKey: string): void {
    setStep('loadingModels')
    setModelLoadError(null)
    void fetchProviderModels({
      providerID,
      apiKey: nextApiKey,
    }).then(result => {
      setAvailableModels(result.models)
      setModelLoadError(result.error ?? null)
      setStep('model')
      setCursorOffset(0)
    })
  }

  if (step === 'provider') {
    if (providers.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color="remember" bold={true}>Loading providers</Text>
          <Text dimColor={true}>Fetching provider catalog from Models.dev...</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold={true}>Connect provider</Text>
          <Text dimColor={true}>Choose a model provider.</Text>
        </Box>
        <Select
          options={providers.map(item => ({
            value: item.providerID,
            label: item.displayName,
            description: item.baseURL ?? item.docURL ?? item.providerID,
          }))}
          onChange={value => {
            const selected = value as ModelProviderID
            setProviderID(selected)
            setStep('apiKey')
          }}
          onCancel={() => onDone('Connect cancelled')}
        />
      </Box>
    )
  }

  if (step === 'baseURL') {
    return (
      <Box flexDirection="column">
        <Text color="remember" bold={true}>Custom provider base URL</Text>
        <TextInput
          value={baseURL}
          onChange={value => {
            setBaseURL(value)
            setCursorOffset(value.length)
          }}
          onSubmit={value => {
            try {
              new URL(value)
              setStep('apiKey')
              setCursorOffset(0)
            } catch {
              onDone('Base URL must be a valid URL.')
            }
          }}
          placeholder="https://gateway.example.com/v1"
          columns={80}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          focus
          showCursor
        />
      </Box>
    )
  }

  if (step === 'apiKey') {
    return (
      <Box flexDirection="column">
        <Text color="remember" bold={true}>{getProviderDisplayName(providerID)} API key</Text>
        <TextInput
          value={apiKey}
          onChange={value => {
            setApiKey(value)
            setCursorOffset(value.length)
          }}
          onSubmit={value => {
            const trimmed = value.trim()
            if (!trimmed) {
              onDone('API key is required.')
              return
            }
            setApiKey(trimmed)
            loadModels(trimmed)
          }}
          placeholder="Paste API key"
          mask="*"
          columns={80}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          focus
          showCursor
        />
      </Box>
    )
  }

  if (step === 'loadingModels') {
    return (
      <Box flexDirection="column">
        <Text color="remember" bold={true}>Loading models</Text>
        <Text dimColor={true}>Fetching models from {getProviderDisplayName(providerID)}...</Text>
      </Box>
    )
  }

  const providerModels = availableModels ?? provider?.defaultModels ?? []
  if (step === 'model' && providerModels.length > 0) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold={true}>Select model</Text>
          <Text dimColor={true}>Choose a model for {getProviderDisplayName(providerID)}.</Text>
          {modelLoadError && (
            <Text color="warning">Could not fetch remote models: {modelLoadError}</Text>
          )}
        </Box>
        <Select
          options={[
            ...providerModels.map(model => ({
              value: model,
              label: model,
            })),
            {
              type: 'input' as const,
              value: '__custom_model__',
              label: 'Custom model',
              placeholder: 'provider/model or model-id',
              initialValue: modelInput,
              resetCursorOnUpdate: true,
              onChange: value => setModelInput(value),
            },
          ]}
          onChange={value => {
            if (value === '__custom_model__') {
              if (!modelInput.trim()) {
                onDone('Model ID is required.')
                return
              }
              save(modelInput)
              return
            }
            save(String(value))
          }}
          onCancel={() => onDone('Connect cancelled')}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text color="remember" bold={true}>Model ID</Text>
      <TextInput
        value={modelInput}
        onChange={value => {
          setModelInput(value)
          setCursorOffset(value.length)
        }}
        onSubmit={save}
        placeholder="model-id"
        columns={80}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
        focus
        showCursor
      />
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  if (args?.trim()) {
    onDone('Run /connect without arguments so API keys never enter slash command history.', {
      display: 'system',
    })
    return
  }
  return <ConnectProvider onDone={onDone} />
}
