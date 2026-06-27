import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { AgentPermissionPolicy } from './permissions.js'
import {
  CODEX_PROJECT_CONFIG_SOURCE,
  parseCodexProjectConfig,
  type CodexHookDiagnostic,
  type CodexMcpServerDiagnostic,
  type CodexProjectConfig,
} from './codexProjectConfig.js'

export type CodexGuidanceSource = {
  path: string
  relativePath: string
  level: number
  isOverride: boolean
  contentHash: string
  summary: string
}

export type {
  CodexHookDiagnostic,
  CodexMcpServerDiagnostic,
  CodexProjectConfig,
}

export type CodexSkillDiagnostic = {
  name: string
  description?: string
  path: string
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

export type CodexWorkspaceTextFile = {
  path?: string
  content: string
}

export type CodexWorkspaceFileReader = (
  relativePath: string,
) => Promise<CodexWorkspaceTextFile | null>

export type DiscoverCodexGuidanceFromWorkspaceOptions =
  DiscoverCodexGuidanceOptions & {
    readFile: CodexWorkspaceFileReader
  }

export type BuildCodexContextDiagnosticsFromWorkspaceOptions =
  BuildCodexContextDiagnosticsOptions & {
    readFile: CodexWorkspaceFileReader
  }

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

export async function buildCodexContextDiagnosticsFromWorkspaceFiles({
  cwd,
  permissionProfile,
  projectRoot,
  readFile,
  skills = [],
}: BuildCodexContextDiagnosticsFromWorkspaceOptions): Promise<CodexContextDiagnostics> {
  const [guidanceSources, projectConfig] = await Promise.all([
    discoverCodexGuidanceSourcesFromWorkspaceFiles({
      cwd,
      projectRoot,
      readFile,
    }),
    readCodexProjectConfigFromWorkspaceFiles(projectRoot, readFile),
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
    sources.push(
      guidanceSourceFromContent({
        absolutePath: selectedPath,
        content,
        isOverride: selectedPath.endsWith('AGENTS.override.md'),
        level,
        relativePath: normalizePath(relative(root, selectedPath)),
      }),
    )
  }

  return sources
}

export async function discoverCodexGuidanceSourcesFromWorkspaceFiles({
  cwd,
  projectRoot,
  readFile,
}: DiscoverCodexGuidanceFromWorkspaceOptions): Promise<CodexGuidanceSource[]> {
  const root = resolve(projectRoot)
  const current = resolve(cwd)
  const directories = directoriesFromRoot(root, current)
  const sources: CodexGuidanceSource[] = []

  for (let level = 0; level < directories.length; level += 1) {
    const directory = directories[level]
    const overrideRelativePath = normalizePath(
      relative(root, join(directory, 'AGENTS.override.md')),
    )
    const normalRelativePath = normalizePath(
      relative(root, join(directory, 'AGENTS.md')),
    )
    const override = await readFile(overrideRelativePath)
    const normal = override ? null : await readFile(normalRelativePath)
    const selected = override ?? normal
    if (!selected) continue

    sources.push(
      guidanceSourceFromContent({
        absolutePath: selected.path ?? join(root, override ? overrideRelativePath : normalRelativePath),
        content: selected.content,
        isOverride: Boolean(override),
        level,
        relativePath: override ? overrideRelativePath : normalRelativePath,
      }),
    )
  }

  return sources
}

export async function readCodexProjectConfig(
  projectRoot: string,
): Promise<CodexProjectConfigDiagnostics> {
  const configPath = join(resolve(projectRoot), '.codex', 'config.toml')
  if (!(await pathExists(configPath))) {
    return emptyProjectConfig()
  }

  const content = await readFile(configPath, 'utf8')
  return readCodexProjectConfigFromContent(configPath, content)
}

export async function readCodexProjectConfigFromWorkspaceFiles(
  projectRoot: string,
  readFile: CodexWorkspaceFileReader,
): Promise<CodexProjectConfigDiagnostics> {
  const config = await readFile(CODEX_PROJECT_CONFIG_SOURCE)
  if (!config) return emptyProjectConfig()
  return readCodexProjectConfigFromContent(
    config.path ?? join(resolve(projectRoot), CODEX_PROJECT_CONFIG_SOURCE),
    config.content,
  )
}

export function readCodexProjectConfigFromContent(
  configPath: string,
  content: string,
): CodexProjectConfigDiagnostics {
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

function emptyProjectConfig(): CodexProjectConfigDiagnostics {
  return {
    path: null,
    config: {},
    ignoredProjectKeys: [],
    diagnostics: [],
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

function summarizeMarkdown(content: string): string {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')
    .slice(0, 160)
}

function guidanceSourceFromContent({
  absolutePath,
  content,
  isOverride,
  level,
  relativePath,
}: {
  absolutePath: string
  content: string
  isOverride: boolean
  level: number
  relativePath: string
}): CodexGuidanceSource {
  return {
    path: absolutePath,
    relativePath,
    level,
    isOverride,
    contentHash: hashContent(content),
    summary: summarizeMarkdown(content),
  }
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
