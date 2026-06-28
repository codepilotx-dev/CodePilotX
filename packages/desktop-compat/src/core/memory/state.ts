import { isAbsolute, join, normalize, sep } from 'node:path'

export const MEMORY_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
] as const

export type MemoryType = (typeof MEMORY_TYPES)[number]

export type AutoMemoryDisabledReason =
  | 'disabled-env'
  | 'simple-mode'
  | 'remote-without-memory-dir'
  | 'settings-disabled'

export type AutoMemoryStateInput = {
  disableAutoMemoryEnv?: string | boolean
  simpleMode?: boolean
  remoteMode?: boolean
  remoteMemoryDir?: string
  settingsEnabled?: boolean
  defaultEnabled: boolean
}

export type AutoMemoryState = {
  enabled: boolean
  disabledReason?: AutoMemoryDisabledReason
}

export type AutoMemoryPathInput = {
  configHomeDir: string
  projectRoot: string
  canonicalProjectRoot?: string | null
  remoteMemoryDir?: string
  pathOverride?: string
  trustedDirectorySetting?: string
  homeDir: string
}

export type AutoMemoryPaths = {
  memoryBaseDir: string
  autoMemPath: string
  entrypointPath: string
  hasPathOverride: boolean
  source: 'override' | 'setting' | 'default'
}

const AUTO_MEM_DIRNAME = 'memory'
const AUTO_MEM_ENTRYPOINT_NAME = 'MEMORY.md'
const MAX_SANITIZED_LENGTH = 100

export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined
  return MEMORY_TYPES.find(type => type === raw)
}

export function resolveAutoMemoryState(
  input: AutoMemoryStateInput,
): AutoMemoryState {
  const env = parseEnvBoolean(input.disableAutoMemoryEnv)
  if (env === true) return { enabled: false, disabledReason: 'disabled-env' }
  if (env === false) return { enabled: true }
  if (input.simpleMode) {
    return { enabled: false, disabledReason: 'simple-mode' }
  }
  if (input.remoteMode && !input.remoteMemoryDir) {
    return {
      enabled: false,
      disabledReason: 'remote-without-memory-dir',
    }
  }
  if (input.settingsEnabled === false) {
    return { enabled: false, disabledReason: 'settings-disabled' }
  }
  if (input.settingsEnabled === true) return { enabled: true }
  return { enabled: input.defaultEnabled }
}

export function resolveAutoMemoryPaths(
  input: AutoMemoryPathInput,
): AutoMemoryPaths {
  const override = validateAutoMemoryDirectory(input.pathOverride, {
    expandTilde: false,
    homeDir: input.homeDir,
  })
  if (override) {
    return {
      memoryBaseDir: input.remoteMemoryDir ?? input.configHomeDir,
      autoMemPath: override,
      entrypointPath: join(override, AUTO_MEM_ENTRYPOINT_NAME),
      hasPathOverride: true,
      source: 'override',
    }
  }

  const setting = validateAutoMemoryDirectory(input.trustedDirectorySetting, {
    expandTilde: true,
    homeDir: input.homeDir,
  })
  if (setting) {
    return {
      memoryBaseDir: input.remoteMemoryDir ?? input.configHomeDir,
      autoMemPath: setting,
      entrypointPath: join(setting, AUTO_MEM_ENTRYPOINT_NAME),
      hasPathOverride: false,
      source: 'setting',
    }
  }

  const memoryBaseDir = input.remoteMemoryDir ?? input.configHomeDir
  const projectRoot = input.canonicalProjectRoot ?? input.projectRoot
  const autoMemPath = (
    join(memoryBaseDir, 'projects', sanitizePath(projectRoot), AUTO_MEM_DIRNAME) +
    sep
  ).normalize('NFC')
  return {
    memoryBaseDir,
    autoMemPath,
    entrypointPath: join(autoMemPath, AUTO_MEM_ENTRYPOINT_NAME),
    hasPathOverride: false,
    source: 'default',
  }
}

export function resolveAutoMemoryDailyLogPath(
  autoMemPath: string,
  date: Date = new Date(),
): string {
  const yyyy = date.getFullYear().toString()
  const mm = (date.getMonth() + 1).toString().padStart(2, '0')
  const dd = date.getDate().toString().padStart(2, '0')
  return join(autoMemPath, 'logs', yyyy, mm, `${yyyy}-${mm}-${dd}.md`)
}

export function isPathWithinAutoMemory(
  autoMemPath: string,
  absolutePath: string,
): boolean {
  return normalize(absolutePath).startsWith(autoMemPath)
}

export function validateAutoMemoryDirectory(
  raw: string | undefined,
  options: { expandTilde: boolean; homeDir: string },
): string | undefined {
  if (!raw) return undefined
  let candidate = raw
  if (
    options.expandTilde &&
    (candidate.startsWith('~/') || candidate.startsWith('~\\'))
  ) {
    const rest = candidate.slice(2)
    const restNorm = normalize(rest || '.')
    if (restNorm === '.' || restNorm === '..') return undefined
    candidate = join(options.homeDir, rest)
  }
  const normalized = normalize(candidate).replace(/[/\\]+$/, '')
  if (
    !isAbsolute(normalized) ||
    normalized.length < 3 ||
    /^[A-Za-z]:$/.test(normalized) ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('//') ||
    normalized.includes('\0')
  ) {
    return undefined
  }
  return (normalized + sep).normalize('NFC')
}

function parseEnvBoolean(value: string | boolean | undefined): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) return sanitized
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${simpleHash(name)}`
}

function simpleHash(input: string): string {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}
