export type ModelProviderCapabilitiesReadParams = Record<string, never>
export type ModelProviderCapabilitiesReadResponse = {
  namespaceTools: boolean
  imageGeneration: boolean
  webSearch: boolean
}

export type ModelListParams = {
  cursor?: string | null
  limit?: number | null
  includeHidden?: boolean | null
}
export type ReasoningEffortOption = {
  reasoningEffort: string
  description: string
}
export type ModelUpgradeInfo = {
  model: string
  upgradeCopy: string | null
  modelLink: string | null
  migrationMarkdown: string | null
}
export type Model = {
  id: string
  model: string
  upgrade: string | null
  upgradeInfo: ModelUpgradeInfo | null
  availabilityNux: { message: string } | null
  displayName: string
  description: string
  hidden: boolean
  supportedReasoningEfforts: ReasoningEffortOption[]
  defaultReasoningEffort: string
  inputModalities: string[]
  supportsPersonality: boolean
  additionalSpeedTiers: string[]
  serviceTiers: Array<{ id: string; name: string; description: string }>
  defaultServiceTier: string | null
  isDefault: boolean
}
export type ModelListResponse = { data: Model[]; nextCursor: string | null }

export type PermissionProfileListParams = {
  cursor?: string | null
  limit?: number | null
  cwd?: string | null
}
export type PermissionProfileListResponse = {
  data: Array<{ id: string; description: string | null }>
  nextCursor: string | null
}

export type SkillsListParams = { cwds?: string[]; forceReload?: boolean }
export type SkillInterface = {
  displayName?: string | null
  shortDescription?: string | null
  iconSmall?: string | null
  iconLarge?: string | null
  brandColor?: string | null
  defaultPrompt?: string | null
}
export type SkillToolDependency = {
  type: string
  value: string
  description?: string
  transport?: string
  command?: string
  url?: string
}
export type SkillDependencies = { tools: SkillToolDependency[] }
export type SkillMetadata = {
  name: string
  description: string
  shortDescription?: string
  interface?: SkillInterface
  dependencies?: SkillDependencies
  path: string
  scope: 'user' | 'repo' | 'system' | 'admin'
  enabled: boolean
}
export type SkillsListResponse = {
  data: Array<{
    cwd: string
    skills: SkillMetadata[]
    errors: Array<{ path: string; message: string }>
  }>
}
export type SkillsConfigWriteParams = {
  path?: string | null
  name?: string | null
  enabled: boolean
}
export type SkillsConfigWriteResponse = { effectiveEnabled: boolean }

export type HooksListParams = { cwds?: string[] }
export type HookMetadata = {
  key: string
  eventName: string
  handlerType: string
  matcher: string | null
  command: string | null
  timeoutSec: number
  statusMessage: string | null
  sourcePath: string
  source: string
  pluginId: string | null
  displayOrder: number
  enabled: boolean
  isManaged: boolean
  currentHash: string
  trustStatus: 'managed' | 'untrusted' | 'trusted' | 'modified'
}
export type HooksListResponse = {
  data: Array<{
    cwd: string
    hooks: HookMetadata[]
    warnings: string[]
    errors: Array<{ path: string; message: string }>
  }>
}

export type ConfigEdit = {
  keyPath: string
  value: unknown
  mergeStrategy: 'replace' | 'upsert'
}
export type ConfigBatchWriteParams = {
  edits: ConfigEdit[]
  filePath?: string | null
  expectedVersion?: string | null
  reloadUserConfig?: boolean
}
export type ConfigLayerSource =
  | { type: 'mdm'; domain: string; key: string }
  | { type: 'system'; file: string }
  | { type: 'enterpriseManaged'; id: string; name: string }
  | { type: 'user'; file: string; profile: string | null }
  | { type: 'project'; dotCodepilotxFolder: string }
  | { type: 'sessionFlags' }
  | { type: 'legacyManagedConfigTomlFromFile'; file: string }
  | { type: 'legacyManagedConfigTomlFromMdm' }
export type ConfigLayerMetadata = {
  name: ConfigLayerSource
  version: string
}
export type OverriddenMetadata = {
  message: string
  overridingLayer: ConfigLayerMetadata
  effectiveValue: unknown
}
export type ConfigWriteResponse = {
  status: 'ok' | 'okOverridden'
  version: string
  filePath: string
  overriddenMetadata: OverriddenMetadata | null
}
