import { join, resolve } from 'node:path'
import type { DesktopWorkspace } from '../shared/types.js'
import { getDesktopConfigDirectoryPath } from './desktopSettings.js'

const STANDALONE_WORKSPACE_NAME = 'Standalone Chat'
const STANDALONE_WORKSPACE_DIRECTORY_NAME = 'chat-workspace'

export function getStandaloneWorkspacePath(): string {
  return join(
    getDesktopConfigDirectoryPath(),
    STANDALONE_WORKSPACE_DIRECTORY_NAME,
  )
}

export function isStandaloneWorkspacePath(workspacePath: string): boolean {
  return (
    normalizeWorkspacePathForComparison(workspacePath) ===
    normalizeWorkspacePathForComparison(getStandaloneWorkspacePath())
  )
}

export function getStandaloneWorkspaceMetadata(): DesktopWorkspace {
  return {
    path: getStandaloneWorkspacePath(),
    name: STANDALONE_WORKSPACE_NAME,
    branchName: null,
    isGitRepo: false,
    isStandalone: true,
  }
}

function normalizeWorkspacePathForComparison(workspacePath: string): string {
  const resolvedPath = resolve(workspacePath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}
