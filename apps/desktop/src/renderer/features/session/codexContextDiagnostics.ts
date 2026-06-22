import {
  buildCodexContextDiagnosticsFromWorkspaceFiles,
  type CodexSkillDiagnostic,
} from '@codepilotx/core/agent/codexContextDiagnosticsShared.js'
import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'
import type { DesktopFilePreview } from '../../../shared/types.js'

export type WorkspaceCodexContextDiagnosticsOptions = {
  workspacePath: string
  cwdPath?: string
  readWorkspaceFile: (
    workspacePath: string,
    filePath: string,
  ) => Promise<DesktopFilePreview>
  readOptionalWorkspaceFile?: (
    workspacePath: string,
    filePath: string,
  ) => Promise<DesktopFilePreview | null>
  permissionProfile?: AgentPermissionPolicy
  skills?: CodexSkillDiagnostic[]
}

export async function buildWorkspaceCodexContextDiagnostics({
  cwdPath,
  permissionProfile,
  readOptionalWorkspaceFile,
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
        const readFilePreview = readOptionalWorkspaceFile ?? readWorkspaceFile
        const preview = await readFilePreview(
          workspacePath,
          joinWorkspacePath(workspacePath, relativePath),
        )
        if (!preview) return null
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
