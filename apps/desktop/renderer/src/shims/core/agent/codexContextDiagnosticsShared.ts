import type { AgentPermissionPolicy } from './permissions.js'
import type { CodePilotXContextDiagnostics } from './codexContextDiagnostics.js'

export type CodePilotXSkillDiagnostic = {
  name: string
  description?: string
  path: string
}

export async function buildCodePilotXContextDiagnosticsFromWorkspaceFiles({
  permissionProfile,
  skills = [],
}: {
  projectRoot: string
  cwd: string
  readFile: (relativePath: string) => Promise<{ path?: string; content: string } | null>
  permissionProfile?: AgentPermissionPolicy
  skills?: CodePilotXSkillDiagnostic[]
}): Promise<CodePilotXContextDiagnostics> {
  return {
    guidanceSources: [],
    projectConfig: {
      path: null,
      config: {},
      ignoredProjectKeys: [],
      diagnostics: [],
    },
    ...(permissionProfile ? { permissionProfile } : {}),
    skills,
  }
}
