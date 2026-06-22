import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { AgentPermissionPolicy } from './permissions.js'

export type CodexGuidanceSource = {
  path: string
  relativePath: string
  level: number
  isOverride: boolean
  contentHash: string
  summary: string
}

export type CodexMcpServerDiagnostic = {
  name: string
  source: string
  command?: string
  args?: string[]
  url?: string
}

export type CodexHookDiagnostic = {
  event: string
  matcher?: string
  commands: string[]
  source: string
}

export type CodexSkillDiagnostic = {
  name: string
  description?: string
  path: string
}

export type CodexProjectConfig = {
  approval?: string
  sandbox?: string
  projectRootMarkers?: string[]
  mcpServers?: CodexMcpServerDiagnostic[]
  hooks?: CodexHookDiagnostic[]
}

export type CodexProjectConfigDiagnostics = {
  path: string | null
  config: CodexProjectConfig
  ignoredProjectKeys: string[]
  diagnostics: string[]
}

export type CodexContextDiagnostics = {
  guidanceSources: CodexGuidanceSource[]
  projectConfig: CodexProjectConfigDiagnostics
  permissionProfile?: AgentPermissionPolicy
  skills: CodexSkillDiagnostic[]
}

export type DiscoverCodexGuidanceOptions = {
  projectRoot: string
  cwd: string
}

export type BuildCodexContextDiagnosticsOptions =
  DiscoverCodexGuidanceOptions & {
    permissionProfile?: AgentPermissionPolicy
    skills?: CodexSkillDiagnostic[]
  }

const PROJECT_CONFIG_SOURCE = '.codex/config.toml'
const PROJECT_IGNORED_KEYS = new Set([
  'openai_base_url',
  'chatgpt_base_url',
  'apps_mcp_product_sku',
  'model_provider',
  'model_providers',
  'notify',
  'profile',
  'profiles',
  'experimental_realtime_ws_base_url',
  'otel',
])

export async function buildCodexContextDiagnostics({
  cwd,
  permissionProfile,
  projectRoot,
  skills = [],
}: BuildCodexContextDiagnosticsOptions): Promise<CodexContextDiagnostics> {
  const [guidanceSources, projectConfig] = await Promise.all([
    discoverCodexGuidanceSources({ cwd, projectRoot }),
    readCodexProjectConfig(projectRoot),
  ])
  return {
    guidanceSources,
    projectConfig,
    ...(permissionProfile ? { permissionProfile } : {}),
    skills,
  }
}

export async function discoverCodexGuidanceSources({
  cwd,
  projectRoot,
}: DiscoverCodexGuidanceOptions): Promise<CodexGuidanceSource[]> {
  const root = resolve(projectRoot)
  const current = resolve(cwd)
  const directories = directoriesFromRoot(root, current)
  const sources: CodexGuidanceSource[] = []

  for (let level = 0; level < directories.length; level += 1) {
    const directory = directories[level]
    const overridePath = join(directory, 'AGENTS.override.md')
    const normalPath = join(directory, 'AGENTS.md')
    const selectedPath = (await pathExists(overridePath))
      ? overridePath
      : (await pathExists(normalPath))
        ? normalPath
        : null
    if (!selectedPath) continue

    const content = await readFile(selectedPath, 'utf8')
    sources.push({
      path: selectedPath,
      relativePath: normalizePath(relative(root, selectedPath)),
      level,
      isOverride: selectedPath.endsWith('AGENTS.override.md'),
      contentHash: hashContent(content),
      summary: summarizeMarkdown(content),
    })
  }

  return sources
}

export async function readCodexProjectConfig(
  projectRoot: string,
): Promise<CodexProjectConfigDiagnostics> {
  const configPath = join(resolve(projectRoot), '.codex', 'config.toml')
  if (!(await pathExists(configPath))) {
    return {
      path: null,
      config: {},
      ignoredProjectKeys: [],
      diagnostics: [],
    }
  }

  const content = await readFile(configPath, 'utf8')
  try {
    return {
      path: configPath,
      ...parseCodexProjectConfig(content),
    }
  } catch (error) {
    return {
      path: configPath,
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

function parseCodexProjectConfig(content: string): Omit<
  CodexProjectConfigDiagnostics,
  'path'
> {
  const config: CodexProjectConfig = {}
  const ignoredProjectKeys = new Set<string>()
  const diagnostics: string[] = []
  const mcpServers = new Map<string, CodexMcpServerDiagnostic>()
  const hookGroups: CodexHookDiagnostic[] = []
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
        const event = parts[1]
        hookGroups.push({
          event,
          commands: [],
          source: PROJECT_CONFIG_SOURCE,
        })
        section = { type: 'hook', event }
        continue
      }
      if (
        parts.length === 3 &&
        parts[0] === 'hooks' &&
        parts[2] === 'hooks'
      ) {
        section = { type: 'hookCommand', event: parts[1] }
        ensureHookGroup(hookGroups, parts[1])
        continue
      }
      diagnostics.push(`忽略不支持的 hooks 表: ${arrayTable[1]}`)
      continue
    }

    const table = line.match(/^\[([^\]]+)]$/)
    if (table) {
      const parts = table[1].split('.')
      if (parts.length === 2 && parts[0] === 'mcp_servers') {
        const name = parts[1]
        mcpServers.set(name, {
          name,
          source: PROJECT_CONFIG_SOURCE,
        })
        section = { type: 'mcp', name }
      } else {
        section = { type: 'root' }
        diagnostics.push(`忽略不支持的配置表: ${table[1]}`)
      }
      continue
    }

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (!assignment) {
      throw new Error(`不支持的配置行: ${line}`)
    }

    const key = assignment[1]
    const value = parseTomlValue(assignment[2])

    if (section.type === 'root') {
      if (PROJECT_IGNORED_KEYS.has(key)) {
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
      if (key === 'command' && typeof value === 'string') {
        server.command = value
      } else if (key === 'url' && typeof value === 'string') {
        server.url = value
      } else if (key === 'args' && isStringArray(value)) {
        server.args = value
      }
      continue
    }

    if (section.type === 'hook') {
      const hook = ensureHookGroup(hookGroups, section.event)
      if (key === 'matcher' && typeof value === 'string') {
        hook.matcher = value
      }
      continue
    }

    if (section.type === 'hookCommand') {
      const hook = ensureHookGroup(hookGroups, section.event)
      if (key === 'command' && typeof value === 'string') {
        hook.commands.push(value)
      }
    }
  }

  if (mcpServers.size > 0) {
    config.mcpServers = [...mcpServers.values()]
  }
  if (hookGroups.length > 0) {
    config.hooks = hookGroups
  }

  return {
    config,
    ignoredProjectKeys: [...ignoredProjectKeys].sort(),
    diagnostics,
  }
}

function directoriesFromRoot(root: string, cwd: string): string[] {
  const relativePath = relative(root, cwd)
  if (relativePath.startsWith('..') || relativePath === '') {
    return relativePath === '' ? [root] : [root, cwd]
  }
  const parts = relativePath.split(sep).filter(Boolean)
  const directories = [root]
  let current = root
  for (const part of parts) {
    current = join(current, part)
    directories.push(current)
  }
  return directories
}

function ensureHookGroup(
  hookGroups: CodexHookDiagnostic[],
  event: string,
): CodexHookDiagnostic {
  const existing = [...hookGroups].reverse().find(hook => hook.event === event)
  if (existing) return existing
  const created = {
    event,
    commands: [],
    source: PROJECT_CONFIG_SOURCE,
  }
  hookGroups.push(created)
  return created
}

function parseTomlValue(rawValue: string): string | string[] {
  const value = rawValue.trim()
  if (value.startsWith('"')) {
    return parseTomlString(value)
  }
  if (value.startsWith('[')) {
    return parseTomlStringArray(value)
  }
  throw new Error(`不支持的 TOML 值: ${value}`)
}

function parseTomlString(value: string): string {
  if (!value.endsWith('"') || value.length < 2) {
    throw new Error(`字符串未闭合: ${value}`)
  }
  return value.slice(1, -1).replace(/\\"/g, '"')
}

function parseTomlStringArray(value: string): string[] {
  if (!value.endsWith(']')) {
    throw new Error(`数组未闭合: ${value}`)
  }
  const body = value.slice(1, -1).trim()
  if (!body) return []
  return body.split(',').map(item => parseTomlString(item.trim()))
}

function stripTomlComment(line: string): string {
  let inString = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index - 1] !== '\\') {
      inString = !inString
    }
    if (char === '#' && !inString) {
      return line.slice(0, index)
    }
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

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function normalizePath(path: string): string {
  return path.split(sep).join('/')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
