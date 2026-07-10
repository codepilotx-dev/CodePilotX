import { execSync } from 'child_process'

export const DESKTOP_TOOLCHAIN_ENABLED_ENV =
  'CODEPILOTX_INSTALL_DEPENDENCIES'
export const DESKTOP_TOOLCHAIN_ROOT_ENV = 'CODEPILOTX_DESKTOP_TOOLCHAIN_ROOT'

export type DesktopToolchainEnvConfig = {
  enabled: boolean
  root: string | null
  pathEntries: string[]
}

export function resolveSystemRipgrepPath(): string | null {
  try {
    const command =
      process.platform === 'win32' ? 'where.exe rg' : 'which rg'
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
    const output = result.trim()
    if (!output) return null
    return output.split(/\r?\n/)[0] || null
  } catch {
    return null
  }
}

export function applyDesktopAgentRuntimeEnvDefaults(
  env: Record<string, string | undefined> = process.env,
): void {
  env.USE_BUILTIN_RIPGREP = '0'

  if (!env.CODEPILOTX_RIPGREP_PATH && !env.CLAUDE_CODE_RIPGREP_PATH) {
    const systemRg = resolveSystemRipgrepPath()
    if (systemRg) {
      env.CODEPILOTX_RIPGREP_PATH = systemRg
      env.CLAUDE_CODE_RIPGREP_PATH = systemRg
    }
  }
}

export function buildDesktopToolchainEnvPatch(
  baseEnv: Record<string, string | undefined>,
  config: DesktopToolchainEnvConfig,
): Record<string, string | undefined> {
  if (!config.enabled) {
    return {
      [DESKTOP_TOOLCHAIN_ENABLED_ENV]: '0',
      [DESKTOP_TOOLCHAIN_ROOT_ENV]: undefined,
    }
  }

  const pathEntries = uniqueNonEmpty(config.pathEntries)
  const patch: Record<string, string | undefined> = {
    [DESKTOP_TOOLCHAIN_ENABLED_ENV]: '1',
    [DESKTOP_TOOLCHAIN_ROOT_ENV]: config.root ?? undefined,
  }
  if (pathEntries.length === 0) {
    return patch
  }

  const pathKey = getPathEnvKey(baseEnv)
  const currentPath = baseEnv[pathKey] ?? ''
  patch[pathKey] = [...pathEntries, currentPath]
    .filter(value => value.trim().length > 0)
    .join(process.platform === 'win32' ? ';' : ':')
  return patch
}

function getPathEnvKey(env: Record<string, string | undefined>): string {
  if (process.platform !== 'win32') return 'PATH'
  const existing = Object.keys(env).find(key => key.toLowerCase() === 'path')
  return existing ?? 'Path'
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>()
  return values.flatMap(value => {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return []
    seen.add(trimmed)
    return [trimmed]
  })
}
