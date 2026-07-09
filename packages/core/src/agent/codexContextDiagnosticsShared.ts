import type { AgentPermissionPolicy } from './permissions.js'
import {
  CODEX_PROJECT_CONFIG_SOURCE,
  parseCodePilotXProjectConfig,
  type CodePilotXHookDiagnostic,
  type CodePilotXMcpServerDiagnostic,
  type CodePilotXProjectConfig,
} from './codexProjectConfig.js'

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

export type CodePilotXWorkspaceTextFile = {
  path?: string
  content: string
}

export type CodePilotXWorkspaceFileReader = (
  relativePath: string,
) => Promise<CodePilotXWorkspaceTextFile | null>

export type DiscoverCodePilotXGuidanceOptions = {
  projectRoot: string
  cwd: string
}

export type BuildCodePilotXContextDiagnosticsOptions =
  DiscoverCodePilotXGuidanceOptions & {
    permissionProfile?: AgentPermissionPolicy
    skills?: CodePilotXSkillDiagnostic[]
  }

export type DiscoverCodePilotXGuidanceFromWorkspaceOptions =
  DiscoverCodePilotXGuidanceOptions & {
    readFile: CodePilotXWorkspaceFileReader
  }

export type BuildCodePilotXContextDiagnosticsFromWorkspaceOptions =
  BuildCodePilotXContextDiagnosticsOptions & {
    readFile: CodePilotXWorkspaceFileReader
  }

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

export async function discoverCodePilotXGuidanceSourcesFromWorkspaceFiles({
  cwd,
  projectRoot,
  readFile,
}: DiscoverCodePilotXGuidanceFromWorkspaceOptions): Promise<CodePilotXGuidanceSource[]> {
  const root = normalizeAbsolutePath(projectRoot)
  const current = normalizeAbsolutePath(cwd)
  const directories = directoriesFromRoot(root, current)
  const sources: CodePilotXGuidanceSource[] = []

  for (let level = 0; level < directories.length; level += 1) {
    const directory = directories[level]
    const overrideRelativePath = relativeFromRoot(
      root,
      joinWorkspacePath(directory, 'AGENTS.override.md'),
    )
    const normalRelativePath = relativeFromRoot(
      root,
      joinWorkspacePath(directory, 'AGENTS.md'),
    )
    const override = await readFile(overrideRelativePath)
    const normal = override ? null : await readFile(normalRelativePath)
    const selected = override ?? normal
    if (!selected) continue

    sources.push(
      await guidanceSourceFromContent({
        absolutePath:
          selected.path ??
          joinWorkspacePath(root, override ? overrideRelativePath : normalRelativePath),
        content: selected.content,
        isOverride: Boolean(override),
        level,
        relativePath: override ? overrideRelativePath : normalRelativePath,
      }),
    )
  }

  return sources
}

export async function readCodePilotXProjectConfigFromWorkspaceFiles(
  projectRoot: string,
  readFile: CodePilotXWorkspaceFileReader,
): Promise<CodePilotXProjectConfigDiagnostics> {
  const config = await readFile(CODEX_PROJECT_CONFIG_SOURCE)
  if (!config) {
    return {
      path: null,
      config: {},
      ignoredProjectKeys: [],
      diagnostics: [],
    }
  }
  return readCodePilotXProjectConfigFromContent(
    config.path ?? joinWorkspacePath(projectRoot, CODEX_PROJECT_CONFIG_SOURCE),
    config.content,
  )
}

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

function directoriesFromRoot(root: string, cwd: string): string[] {
  if (cwd === root) return [root]
  if (!cwd.startsWith(`${root}/`)) return [root, cwd]

  const parts = cwd.slice(root.length + 1).split('/').filter(Boolean)
  const directories = [root]
  let current = root
  for (const part of parts) {
    current = joinWorkspacePath(current, part)
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

async function guidanceSourceFromContent({
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
}): Promise<CodePilotXGuidanceSource> {
  return {
    path: absolutePath,
    relativePath,
    level,
    isOverride,
    contentHash: await hashContent(content),
    summary: summarizeMarkdown(content),
  }
}

async function hashContent(content: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(content),
    )
    return [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16)
  }
  return fallbackHashContent(content)
}

function fallbackHashContent(content: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const byte of new TextEncoder().encode(content)) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0').slice(0, 16)
}

function normalizeAbsolutePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function relativeFromRoot(root: string, target: string): string {
  const normalizedTarget = normalizeAbsolutePath(target)
  if (normalizedTarget === root) return ''
  if (normalizedTarget.startsWith(`${root}/`)) {
    return normalizedTarget.slice(root.length + 1)
  }
  return normalizedTarget
}

function joinWorkspacePath(base: string, path: string): string {
  const normalizedBase = normalizeAbsolutePath(base)
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/g, '')
  return `${normalizedBase}/${normalizedPath}`.replace(/\/+/g, '/')
}
