import { execSync } from 'child_process'

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
