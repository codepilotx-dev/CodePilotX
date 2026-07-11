export type ApiKeyConnectionSavePlan =
  | { kind: 'save-key-and-connection'; apiKey: string }
  | { kind: 'save-connection' }
  | { kind: 'missing-credential' }

export type ConnectionSaveContext = {
  id: number
  providerID: string
  baseURL: string
  model: string
}

export function isConnectionSaveContextCurrent(
  request: ConnectionSaveContext,
  currentRequestID: number,
  current: Pick<ConnectionSaveContext, 'providerID' | 'baseURL' | 'model'>,
): boolean {
  return (
    request.id === currentRequestID &&
    request.providerID === current.providerID &&
    request.baseURL === current.baseURL &&
    request.model === current.model
  )
}

export function getApiKeyConnectionSavePlan(
  apiKey: string,
  apiKeyConfigured: boolean,
): ApiKeyConnectionSavePlan {
  const trimmedApiKey = apiKey.trim()
  if (trimmedApiKey) {
    return { kind: 'save-key-and-connection', apiKey: trimmedApiKey }
  }
  if (apiKeyConfigured) return { kind: 'save-connection' }
  return { kind: 'missing-credential' }
}
