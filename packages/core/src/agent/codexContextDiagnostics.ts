import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { AgentPermissionPolicy } from './permissions.js'
import {
  CODEX_PROJECT_CONFIG_SOURCE,
  parseCodePilotXProjectConfig,
  type CodePilotXHookDiagnostic,
  type CodePilotXMcpServerDiagnostic,
  type CodePilotXProjectConfig,
} from './codexProjectConfig.js'

// Re-export for backward compatibility
export type {
  CodePilotXHookDiagnostic,
  CodePilotXMcpServerDiagnostic,
  CodePilotXProjectConfig,
}

export type CodePilotXGuidanceSource = {
  path: string
  relativePath: string
  level: number
  isOverride: boolean
  contentHash: string
  summary: string
}

export type {
  CodePilotXHookDiagnostic,
  CodePilotXMcpServerDiagnostic,
  CodePilotXProjectConfig,
}

export type CodePilotXSkillDiagnostic = {
  name: string
  description?: string
  path: string
}

export type CodePilotXProjectConfigDiagnostics = {
  path: string | null
  config: CodePilotXProjectConfig
  ignoredProjectKeys: string[]
  diagnostics: string[]
}

export type CodePilotXContextDiagnostics = {
  guidanceSources: CodePilotXGuidanceSource[]
  projectConfig: CodePilotXProjectConfigDiagnostics
  permissionProfile?: AgentPermissionPolicy
  skills: CodePilotXSkillDiagnostic[]
}

export type DiscoverCodePilotXGuidanceOptions = {
  projectRoot: string
  cwd: string
}

export type BuildCodePilotXContextDiagnosticsOptions =
  DiscoverCodePilotXGuidanceOptions & {
    permissionProfile?: AgentPermissionPolicy
    skills?: CodePilotXSkillDiagnostic[]
  }

export type CodePilotXWorkspaceTextFile = {
  path?: string
  content: string
}

export type CodePilotXWorkspaceFileReader = (
  relativePath: string,
) => Promise<CodePilotXWorkspaceTextFile | null>

export type DiscoverCodePilotXGuidanceFromWorkspaceOptions =
  DiscoverCodePilotXGuidanceOptions & {
    readFile: CodePilotXWorkspaceFileReader
  }

export type BuildCodePilotXContextDiagnosticsFromWorkspaceOptions =
  BuildCodePilotXContextDiagnosticsOptions & {
    readFile: CodePilotXWorkspaceFileReader
  }

export async function buildCodePilotXContextDiagnostics({
  cwd,
  permissionProfile,
  projectRoot,
  skills = [],
}: BuildCodePilotXContextDiagnosticsOptions): Promise<CodePilotXContextDiagnostics> {
  const [guidanceSources, projectConfig] = await Promise.all([
    discoverCodePilotXGuidanceSources({ cwd, projectRoot }),
    readCodePilotXProjectConfig(projectRoot),
  ])
  return {
    guidanceSources,
    projectConfig,
    ...(permissionProfile ? { permissionProfile } : {}),
    skills,
  }
}

// Transitional alias while call sites migrate.
export const buildCodexContextDiagnostics = buildCodePilotXContextDiagnostics

export async function buildCodePilotXContextDiagnosticsFromWorkspaceFiles({
  cwd,
  permissionProfile,
  projectRoot,
  readFile,
  skills = [],
}: BuildCodePilotXContextDiagnosticsFromWorkspaceOptions): Promise<CodePilotXContextDiagnostics> {
  const [guidanceSources, projectConfig] = await Promise.all([
    discoverCodePilotXGuidanceSourcesFromWorkspaceFiles({
      cwd,
      projectRoot,
      readFile,
    }),
    readCodePilotXProjectConfigFromWorkspaceFiles(projectRoot, readFile),
  ])
  return {
    guidanceSources,
    projectConfig,
    ...(permissionProfile ? { permissionProfile } : {}),
    skills,
  }
}

// Transitional alias while call sites migrate.
export const buildCodexContextDiagnosticsFromWorkspaceFiles = buildCodePilotXContextDiagnosticsFromWorkspaceFiles

export async function discoverCodePilotXGuidanceSources({
  cwd,
  projectRoot,
}: DiscoverCodePilotXGuidanceOptions): Promise<CodePilotXGuidanceSource[]> {
  const root = resolve(projectRoot)
  const current = resolve(cwd)
  const directories = directoriesFromRoot(root, current)
  const sources: CodePilotXGuidanceSource[] = []

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

// Transitional alias while call sites migrate.
export const discoverCodexGuidanceSources = discoverCodePilotXGuidanceSources

export async function discoverCodePilotXGuidanceSourcesFromWorkspaceFiles({
  cwd,
  projectRoot,
  readFile,
}: DiscoverCodePilotXGuidanceFromWorkspaceOptions): Promise<CodePilotXGuidanceSource[]> {
  const root = resolve(projectRoot)
  const current = resolve(cwd)
  const directories = directoriesFromRoot(root, current)
  const sources: CodePilotXGuidanceSource[] = []

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

// Transitional alias while call sites migrate.
export const discoverCodexGuidanceSourcesFromWorkspaceFiles = discoverCodePilotXGuidanceSourcesFromWorkspaceFiles

export async function readCodePilotXProjectConfig(
  projectRoot: string,
): Promise<CodePilotXProjectConfigDiagnostics> {
  const configPath = join(resolve(projectRoot), '.codepilotx', 'config.toml')
  if (!(await pathExists(configPath))) {
    return emptyProjectConfig()
  }

  const content = await readFile(configPath, 'utf8')
  return readCodePilotXProjectConfigFromContent(configPath, content)
}

// Transitional alias while call sites migrate.
export const readCodexProjectConfig = readCodePilotXProjectConfig

export async function readCodePilotXProjectConfigFromWorkspaceFiles(
  projectRoot: string,
  readFile: CodePilotXWorkspaceFileReader,
): Promise<CodePilotXProjectConfigDiagnostics> {
  const config = await readFile(CODEX_PROJECT_CONFIG_SOURCE)
  if (!config) return emptyProjectConfig()
  return readCodePilotXProjectConfigFromContent(
    config.path ?? join(resolve(projectRoot), CODEX_PROJECT_CONFIG_SOURCE),
    config.content,
  )
}

// Transitional alias while call sites migrate.
export const readCodexProjectConfigFromWorkspaceFiles = readCodePilotXProjectConfigFromWorkspaceFiles

export function readCodePilotXProjectConfigFromContent(
  configPath: string,
  content: string,
): CodePilotXProjectConfigDiagnostics {
  try {
    return {
      path: configPath,
      ...parseCodePilotXProjectConfig(content),
    }
  } catch (error) {
    return {
      path: configPath,
      config: {},
      ignoredProjectKeys: [],
      diagnostics: [
        `无法解析 .codepilotx/config.toml: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    }
  }
}

// Transitional alias while call sites migrate.
export const readCodexProjectConfigFromContent = readCodePilotXProjectConfigFromContent

function emptyProjectConfig(): CodePilotXProjectConfigDiagnostics {
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
}): CodePilotXGuidanceSource {
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
