export type ModelConnectionVerificationStatus =
  | 'idle'
  | 'testing'
  | 'success'
  | 'error'

export type VerificationRequestContext = {
  id: number
  providerID: string
  baseURL: string
}

export function isVerificationRequestCurrent(
  request: VerificationRequestContext,
  currentRequestID: number,
  providerID: string,
  baseURL: string,
): boolean {
  return (
    request.id === currentRequestID &&
    request.providerID === providerID &&
    request.baseURL === baseURL
  )
}

export function getCredentialVerificationLabel(
  status: ModelConnectionVerificationStatus,
  configured: boolean,
): string {
  if (status === 'testing') return '验证中'
  if (status === 'success') return '可用'
  if (status === 'error') return '不可用'
  return configured ? '已配置 · 未验证' : '未配置'
}

export function getModelVerificationLabel(
  status: ModelConnectionVerificationStatus,
  availableCount: number,
  totalCount: number,
): string {
  if (status === 'testing') return '验证中'
  if (status === 'success') return `可用 ${availableCount} / 共 ${totalCount}`
  if (status === 'error') return '验证失败'
  return '未验证'
}

export function collectAvailableModelIDs(
  displayedModelIDs: string[],
  verifiedModelIDs: string[],
): Set<string> {
  const verified = new Set(verifiedModelIDs)
  return new Set(displayedModelIDs.filter(modelID => verified.has(modelID)))
}
