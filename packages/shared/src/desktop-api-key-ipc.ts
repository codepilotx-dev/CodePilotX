export const DESKTOP_API_KEY_IPC_CHANNELS = {
  copy: "api-key:copy",
} as const

export type DesktopApiKeyCopyResult = {
  clearAfterMs: 60000
}

export interface DesktopApiKeyIpcBridge {
  copyProviderApiKey(credentialId: string): Promise<DesktopApiKeyCopyResult>
}
