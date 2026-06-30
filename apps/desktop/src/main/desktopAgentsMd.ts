import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const DEFAULT_AGENTS_MD_FILENAME = 'AGENTS.md'
export const LOCAL_AGENTS_MD_FILENAME = 'AGENTS.override.md'
export const GLOBAL_AGENTS_MD_DIRNAME = '.codepilotx'
export const AGENTS_MD_SEPARATOR = '\n\n--- project-doc ---\n\n'
export const AGENTS_MD_MAX_BYTES = 32 * 1024

export type DesktopAgentsMdDoc = {
  path: string
  content: string
}

export type DiscoverProjectAgentsMdOptions = {
  projectRoot: string
  cwd: string
  maxBytes?: number
}

export type BuildSessionAppendSystemPromptOptions = {
  configHomeDir: string
  projectRoot: string
  cwd?: string
  existingAppendSystemPrompt?: string
}

export function getGlobalAgentsMdPath(_configHomeDir: string): string {
  return join(
    process.env.USERPROFILE ?? homedir(),
    GLOBAL_AGENTS_MD_DIRNAME,
    DEFAULT_AGENTS_MD_FILENAME,
  )
}

export async function readGlobalAgentsMd(
  configHomeDir: string,
): Promise<string | null> {
  try {
    const text = await readFile(getGlobalAgentsMdPath(configHomeDir), 'utf8')
    return text
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

export async function saveGlobalAgentsMd(
  configHomeDir: string,
  content: string,
): Promise<void> {
  const path = getGlobalAgentsMdPath(configHomeDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

export async function discoverProjectAgentsMd({
  cwd,
  maxBytes = AGENTS_MD_MAX_BYTES,
  projectRoot,
}: DiscoverProjectAgentsMdOptions): Promise<DesktopAgentsMdDoc[]> {
  if (maxBytes <= 0) return []
  const directories = directoriesFromRoot(resolve(projectRoot), resolve(cwd))
  const docs: DesktopAgentsMdDoc[] = []
  let remaining = maxBytes

  for (const directory of directories) {
    if (remaining <= 0) break
    const selected = await selectAgentsMdPath(directory)
    if (!selected) continue

    const data = await readFile(selected)
    const truncated = data.subarray(0, remaining)
    const content = truncated.toString('utf8')
    if (content.trim()) {
      docs.push({ path: selected, content })
      remaining -= truncated.byteLength
    }
  }

  return docs
}

export function buildAgentsMdInstructions(
  globalInstructions: string | null | undefined,
  directory: string | null | undefined,
  projectDocs: DesktopAgentsMdDoc[],
): string | null {
  const text = buildAgentsMdText(globalInstructions, projectDocs)
  if (!text) return null
  const directoryLabel = directory ? ` for ${directory}` : ''
  return `# AGENTS.md instructions${directoryLabel}\n\n<INSTRUCTIONS>\n${text}\n</INSTRUCTIONS>`
}

export async function buildSessionAppendSystemPrompt({
  configHomeDir,
  cwd,
  existingAppendSystemPrompt,
  projectRoot,
}: BuildSessionAppendSystemPromptOptions): Promise<string | undefined> {
  const [globalInstructions, projectDocs] = await Promise.all([
    readGlobalAgentsMd(configHomeDir),
    discoverProjectAgentsMd({
      cwd: cwd ?? projectRoot,
      projectRoot,
    }),
  ])
  const agentsMdInstructions = buildAgentsMdInstructions(
    globalInstructions,
    projectDocs.length > 0 ? cwd ?? projectRoot : null,
    projectDocs,
  )
  const parts = [agentsMdInstructions, existingAppendSystemPrompt]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function buildAgentsMdText(
  globalInstructions: string | null | undefined,
  projectDocs: DesktopAgentsMdDoc[],
): string | null {
  const parts: string[] = []
  const globalText = globalInstructions?.trim() ? globalInstructions : null
  if (globalText) parts.push(globalText)

  const projectText = projectDocs
    .map(doc => doc.content)
    .filter(content => content.trim())
    .join('\n\n')
  if (projectText) {
    if (parts.length > 0) {
      parts.push(AGENTS_MD_SEPARATOR.trim())
    }
    parts.push(projectText)
  }

  if (parts.length === 0) return null
  return parts.join('\n\n')
}

async function selectAgentsMdPath(directory: string): Promise<string | null> {
  const overridePath = join(directory, LOCAL_AGENTS_MD_FILENAME)
  if (await isFile(overridePath)) return overridePath
  const defaultPath = join(directory, DEFAULT_AGENTS_MD_FILENAME)
  if (await isFile(defaultPath)) return defaultPath
  return null
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isMissingFileError(error)) return false
    throw error
  }
}

function directoriesFromRoot(root: string, cwd: string): string[] {
  const relativePath = relative(root, cwd)
  if (relativePath.startsWith('..') || relativePath === '') {
    return relativePath === '' ? [root] : [root, cwd]
  }
  const directories = [root]
  let current = root
  for (const part of relativePath.split(sep).filter(Boolean)) {
    current = join(current, part)
    directories.push(current)
  }
  return directories
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
