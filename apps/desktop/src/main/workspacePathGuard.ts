import { existsSync, realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const allowedWorkspacePaths = new Set<string>()

export function normalizeWorkspacePath(workspacePath: string): string {
  const resolvedPath = resolve(workspacePath)
  // Resolve symlinks/junctions to prevent escape via realpath bypass.
  // If the path doesn't exist yet (e.g. new workspace), fall back to resolve.
  const realPath = existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath
  return process.platform === 'win32' ? realPath.toLowerCase() : realPath
}

export function registerAllowedWorkspace(workspacePath: string): void {
  allowedWorkspacePaths.add(normalizeWorkspacePath(workspacePath))
}

export function registerAllowedWorkspaces(workspacePaths: string[]): void {
  for (const workspacePath of workspacePaths) {
    registerAllowedWorkspace(workspacePath)
  }
}

export function assertAllowedWorkspace(workspacePath: string): string {
  const resolvedPath = resolve(workspacePath)
  if (!allowedWorkspacePaths.has(normalizeWorkspacePath(resolvedPath))) {
    throw new Error('Workspace must be selected before it can be used.')
  }
  return resolvedPath
}

export function assertPathInsideAllowedWorkspace(targetPath: string): string {
  const resolvedTarget = resolve(targetPath)
  if (!isPathInsideAllowedWorkspace(resolvedTarget)) {
    throw new Error('Path must be inside a selected workspace.')
  }
  return resolvedTarget
}

export function isPathInsideAllowedWorkspace(targetPath: string): boolean {
  const normalizedTarget = normalizeWorkspacePath(targetPath)
  for (const normalizedWorkspace of allowedWorkspacePaths) {
    if (normalizedTarget === normalizedWorkspace) {
      return true
    }
    const workspacePrefix = normalizedWorkspace.endsWith(sep)
      ? normalizedWorkspace
      : `${normalizedWorkspace}${sep}`
    if (normalizedTarget.startsWith(workspacePrefix)) {
      return true
    }
  }
  return false
}

export function clearAllowedWorkspacesForTest(): void {
  allowedWorkspacePaths.clear()
}
