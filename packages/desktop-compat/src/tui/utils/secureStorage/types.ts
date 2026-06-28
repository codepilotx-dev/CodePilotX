export type SecureStorageData = {
  claudeAiOauth?: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    scopes: string[]
    subscriptionType?: string | null
    rateLimitTier?: string | null
  }
  mcpOAuth?: Record<string, unknown>
  mcpOAuthClientConfig?: Record<string, unknown>
  pluginSecrets?: Record<string, Record<string, unknown>>
  providerApiKeys?: Record<string, string>
  [key: string]: unknown
}

export type SecureStorage = {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): { success: boolean; warning?: string }
  delete(): boolean
}
