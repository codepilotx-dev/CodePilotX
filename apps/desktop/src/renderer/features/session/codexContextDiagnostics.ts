import type {
  CodexContextDiagnostics,
  CodexGuidanceSource,
  CodexHookDiagnostic,
  CodexMcpServerDiagnostic,
  CodexProjectConfig,
  CodexProjectConfigDiagnostics,
  CodexSkillDiagnostic,
} from '@codepilotx/core/agent/codexContextDiagnostics.js'
import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'
import type { DesktopFilePreview } from '../../../shared/types.js'

export type WorkspaceCodexContextDiagnosticsOptions = {
  workspacePath: string
  readWorkspaceFile: (
    workspacePath: string,
    filePath: string,
  ) => Promise<DesktopFilePreview>
  permissionProfile?: AgentPermissionPolicy
  skills?: CodexSkillDiagnostic[]
}

const CONFIG_SOURCE = '.codex/config.toml'
const IGNORED_PROJECT_KEYS = new Set(['model_provider', 'profile', 'telemetry'])

export async function buildWorkspaceCodexContextDiagnostics({
  permissionProfile,
  readWorkspaceFile,
  skills = [],
  workspacePath,
}: WorkspaceCodexContextDiagnosticsOptions): Promise<CodexContextDiagnostics> {
  const [guidanceSources, projectConfig] = await Promise.all([
    readRootGuidanceSource(workspacePath, readWorkspaceFile),
    readRootProjectConfig(workspacePath, readWorkspaceFile),
  ])

  return {
    guidanceSources,
    projectConfig,
    ...(permissionProfile ? { permissionProfile } : {}),
    skills,
  }
}

async function readRootGuidanceSource(
  workspacePath: string,
  readWorkspaceFile: WorkspaceCodexContextDiagnosticsOptions['readWorkspaceFile'],
): Promise<CodexGuidanceSource[]> {
  const override = await readOptionalWorkspaceFile(
    workspacePath,
    'AGENTS.override.md',
    readWorkspaceFile,
  )
  if (override) {
    return [guidanceSourceFromContent(override.path, 'AGENTS.override.md', true, override.content)]
  }

  const normal = await readOptionalWorkspaceFile(
    workspacePath,
    'AGENTS.md',
    readWorkspaceFile,
  )
  if (!normal) return []
  return [guidanceSourceFromContent(normal.path, 'AGENTS.md', false, normal.content)]
}

async function readRootProjectConfig(
  workspacePath: string,
  readWorkspaceFile: WorkspaceCodexContextDiagnosticsOptions['readWorkspaceFile'],
): Promise<CodexProjectConfigDiagnostics> {
  const preview = await readOptionalWorkspaceFile(
    workspacePath,
    CONFIG_SOURCE,
    readWorkspaceFile,
  )
  if (!preview) {
    return {
      path: null,
      config: {},
      ignoredProjectKeys: [],
      diagnostics: [],
    }
  }

  try {
    return {
      path: preview.path,
      ...parseProjectConfig(preview.content),
    }
  } catch (error) {
    return {
      path: preview.path,
      config: {},
      ignoredProjectKeys: [],
      diagnostics: [
        `无法解析 .codex/config.toml: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    }
  }
}

async function readOptionalWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  readWorkspaceFile: WorkspaceCodexContextDiagnosticsOptions['readWorkspaceFile'],
): Promise<DesktopFilePreview | null> {
  try {
    return await readWorkspaceFile(
      workspacePath,
      joinWorkspacePath(workspacePath, relativePath),
    )
  } catch {
    return null
  }
}

function guidanceSourceFromContent(
  path: string,
  relativePath: string,
  isOverride: boolean,
  content: string,
): CodexGuidanceSource {
  return {
    path,
    relativePath,
    level: 0,
    isOverride,
    contentHash: shortHash(content),
    summary: summarizeMarkdown(content),
  }
}

function parseProjectConfig(content: string): Omit<
  CodexProjectConfigDiagnostics,
  'path'
> {
  const config: CodexProjectConfig = {}
  const ignoredProjectKeys = new Set<string>()
  const diagnostics: string[] = []
  const mcpServers = new Map<string, CodexMcpServerDiagnostic>()
  const hooks: CodexHookDiagnostic[] = []
  let section:
    | { type: 'root' }
    | { type: 'mcp'; name: string }
    | { type: 'hook'; event: string }
    | { type: 'hookCommand'; event: string } = { type: 'root' }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue

    const arrayTable = line.match(/^\[\[([^\]]+)]]$/)
    if (arrayTable) {
      const parts = arrayTable[1].split('.')
      if (parts.length === 2 && parts[0] === 'hooks') {
        hooks.push({ event: parts[1], commands: [], source: CONFIG_SOURCE })
        section = { type: 'hook', event: parts[1] }
        continue
      }
      if (
        parts.length === 3 &&
        parts[0] === 'hooks' &&
        parts[2] === 'hooks'
      ) {
        ensureHook(hooks, parts[1])
        section = { type: 'hookCommand', event: parts[1] }
        continue
      }
      diagnostics.push(`忽略不支持的 hooks 表: ${arrayTable[1]}`)
      continue
    }

    const table = line.match(/^\[([^\]]+)]$/)
    if (table) {
      const parts = table[1].split('.')
      if (parts.length === 2 && parts[0] === 'mcp_servers') {
        mcpServers.set(parts[1], { name: parts[1], source: CONFIG_SOURCE })
        section = { type: 'mcp', name: parts[1] }
      } else {
        diagnostics.push(`忽略不支持的配置表: ${table[1]}`)
        section = { type: 'root' }
      }
      continue
    }

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (!assignment) throw new Error(`不支持的配置行: ${line}`)
    const key = assignment[1]
    const value = parseTomlValue(assignment[2])

    if (section.type === 'root') {
      if (IGNORED_PROJECT_KEYS.has(key)) {
        ignoredProjectKeys.add(key)
        continue
      }
      if (key === 'approval' && typeof value === 'string') {
        config.approval = value
      } else if (key === 'sandbox' && typeof value === 'string') {
        config.sandbox = value
      } else if (key === 'project_root_markers' && isStringArray(value)) {
        config.projectRootMarkers = value
      }
      continue
    }

    if (section.type === 'mcp') {
      const server = mcpServers.get(section.name)
      if (!server) continue
      if (key === 'command' && typeof value === 'string') server.command = value
      if (key === 'url' && typeof value === 'string') server.url = value
      if (key === 'args' && isStringArray(value)) server.args = value
      continue
    }

    if (section.type === 'hook') {
      const hook = ensureHook(hooks, section.event)
      if (key === 'matcher' && typeof value === 'string') hook.matcher = value
      continue
    }

    if (section.type === 'hookCommand') {
      const hook = ensureHook(hooks, section.event)
      if (key === 'command' && typeof value === 'string') {
        hook.commands.push(value)
      }
    }
  }

  if (mcpServers.size > 0) config.mcpServers = [...mcpServers.values()]
  if (hooks.length > 0) config.hooks = hooks

  return {
    config,
    ignoredProjectKeys: [...ignoredProjectKeys].sort(),
    diagnostics,
  }
}

function ensureHook(hooks: CodexHookDiagnostic[], event: string): CodexHookDiagnostic {
  const existing = [...hooks].reverse().find(hook => hook.event === event)
  if (existing) return existing
  const created = { event, commands: [], source: CONFIG_SOURCE }
  hooks.push(created)
  return created
}

function parseTomlValue(value: string): string | string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) return parseTomlString(trimmed)
  if (trimmed.startsWith('[')) return parseTomlStringArray(trimmed)
  throw new Error(`不支持的 TOML 值: ${trimmed}`)
}

function parseTomlString(value: string): string {
  if (!value.endsWith('"') || value.length < 2) {
    throw new Error(`字符串未闭合: ${value}`)
  }
  return value.slice(1, -1).replace(/\\"/g, '"')
}

function parseTomlStringArray(value: string): string[] {
  if (!value.endsWith(']')) throw new Error(`数组未闭合: ${value}`)
  const body = value.slice(1, -1).trim()
  return body ? body.split(',').map(item => parseTomlString(item.trim())) : []
}

function stripTomlComment(line: string): string {
  let inString = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index - 1] !== '\\') inString = !inString
    if (char === '#' && !inString) return line.slice(0, index)
  }
  return line
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function summarizeMarkdown(content: string): string {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')
    .slice(0, 160)
}

function joinWorkspacePath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes('\\') ? '\\' : '/'
  const base = workspacePath.endsWith('\\') || workspacePath.endsWith('/')
    ? workspacePath.slice(0, -1)
    : workspacePath
  return `${base}${separator}${relativePath.replace(/\//g, separator)}`
}

function shortHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(2).slice(0, 16)
}
