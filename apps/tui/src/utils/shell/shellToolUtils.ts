import { existsSync } from 'fs'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy } from '../envUtils.js'
import { getPlatform } from '../platform.js'
import { whichSync } from '../which.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

/**
 * Runtime gate for PowerShellTool. Windows-only because the permission engine
 * uses Win32-specific path normalizations. Defaults on in Windows builds and
 * remains opt-out via CLAUDE_CODE_USE_POWERSHELL_TOOL=0.
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  return !isEnvDefinedFalsy(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL)
}

function getWindowsPosixShellCandidates(): string[] {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 =
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA

  return [
    `${programFiles}\\Git\\bin\\bash.exe`,
    `${programFiles}\\Git\\usr\\bin\\bash.exe`,
    `${programFilesX86}\\Git\\bin\\bash.exe`,
    `${programFilesX86}\\Git\\usr\\bin\\bash.exe`,
    localAppData ? `${localAppData}\\Programs\\Git\\bin\\bash.exe` : null,
    localAppData ? `${localAppData}\\Programs\\Git\\usr\\bin\\bash.exe` : null,
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\msys2\\usr\\bin\\bash.exe',
  ].filter((candidate): candidate is string => candidate !== null)
}

export function hasUsablePosixShellSync(): boolean {
  const shellOverride = process.env.CLAUDE_CODE_SHELL
  if (
    shellOverride &&
    (shellOverride.includes('bash') || shellOverride.includes('zsh')) &&
    (existsSync(shellOverride) || whichSync(shellOverride) !== null)
  ) {
    return true
  }

  if (whichSync('bash') !== null || whichSync('zsh') !== null) {
    return true
  }

  if (getPlatform() !== 'windows') {
    return true
  }

  return getWindowsPosixShellCandidates().some(candidate => existsSync(candidate))
}

export function isBashToolEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_USE_BASH_TOOL)) {
    return false
  }
  return hasUsablePosixShellSync()
}
