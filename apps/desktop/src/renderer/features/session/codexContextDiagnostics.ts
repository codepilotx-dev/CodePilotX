import {
  buildCodexContextDiagnosticsFromWorkspaceFiles,
  type CodexSkillDiagnostic,
} from '@codepilotx/core/agent/codexContextDiagnostics.js'
import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'
import type { DesktopFilePreview } from '../../../shared/types.js'

export type WorkspaceCodexContextDiagnosticsOptions = {
  workspacePath: string
  cwdPath?: string
  readWorkspaceFile: (
    workspacePath: string,
    filePath: string,
  ) => Promise<DesktopFilePreview>
  permissionProfile?: AgentPermissionPolicy
  skills?: CodexSkillDiagnostic[]
}

export async function buildWorkspaceCodexContextDiagnostics({
  cwdPath,
  permissionProfile,
  readWorkspaceFile,
  skills = [],
  workspacePath,
}: WorkspaceCodexContextDiagnosticsOptions) {
  return buildCodexContextDiagnosticsFromWorkspaceFiles({
    cwd: cwdPath ?? workspacePath,
    permissionProfile,
    projectRoot: workspacePath,
    readFile: async relativePath => {
      try {
        const preview = await readWorkspaceFile(
          workspacePath,
          joinWorkspacePath(workspacePath, relativePath),
        )
        return {
          path: preview.path,
          content: preview.content,
        }
      } catch {
        return null
      }
    },
    skills,
  })
}

function joinWorkspacePath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes('\\') ? '\\' : '/'
  const base =
    workspacePath.endsWith('\\') || workspacePath.endsWith('/')
      ? workspacePath.slice(0, -1)
      : workspacePath
  return `${base}${separator}${relativePath.replace(/\//g, separator)}`
}
