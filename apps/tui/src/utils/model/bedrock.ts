import memoize from 'lodash-es/memoize.js'

export const getBedrockInferenceProfiles = memoize(async function (): Promise<
  string[]
> {
  return []
})

export function findFirstMatch(
  profiles: string[],
  substring: string,
): string | null {
  return profiles.find(p => p.includes(substring)) ?? null
}

export async function createBedrockRuntimeClient(): Promise<never> {
  throw new Error('AWS Bedrock support has been removed from this build.')
}

export const getInferenceProfileBackingModel = memoize(async function (
  _profileId: string,
): Promise<string | null> {
  return null
})

export function isFoundationModel(modelId: string): boolean {
  return modelId.startsWith('anthropic.')
}

const BEDROCK_REGION_PREFIXES = ['us', 'eu', 'apac', 'global'] as const

export function extractModelIdFromArn(modelId: string): string {
  if (!modelId.startsWith('arn:')) {
    return modelId
  }
  const lastSlashIndex = modelId.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return modelId
  }
  return modelId.substring(lastSlashIndex + 1)
}

export type BedrockRegionPrefix = (typeof BEDROCK_REGION_PREFIXES)[number]

export function getBedrockRegionPrefix(
  modelId: string,
): BedrockRegionPrefix | undefined {
  const effectiveModelId = extractModelIdFromArn(modelId)

  for (const prefix of BEDROCK_REGION_PREFIXES) {
    if (effectiveModelId.startsWith(`${prefix}.anthropic.`)) {
      return prefix
    }
  }
  return undefined
}

export function applyBedrockRegionPrefix(
  modelId: string,
  prefix: BedrockRegionPrefix,
): string {
  const existingPrefix = getBedrockRegionPrefix(modelId)
  if (existingPrefix) {
    return modelId.replace(`${existingPrefix}.`, `${prefix}.`)
  }

  if (isFoundationModel(modelId)) {
    return `${prefix}.${modelId}`
  }

  return modelId
}
