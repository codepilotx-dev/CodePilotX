import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { resolveAutoMemoryPaths, type MemoryType, parseMemoryType } from '@codepilotx/core/memory/state.js'

const ENTRYPOINT_NAME = 'MEMORY.md'
const RECALL_LOG_NAME = '.recall-events.jsonl'

export type DesktopProjectMemory = {
  relativePath: string
  absolutePath: string
  type?: MemoryType
  description: string | null
  size: number
  mtimeMs: number
}

export type DesktopProjectMemoryListing = {
  memoryDir: string
  entrypointPath: string
  memories: DesktopProjectMemory[]
}

export type SaveProjectMemoryInput = {
  workspacePath: string
  configHomeDir?: string
  relativePath: string
  content: string
}

export type DeleteProjectMemoryInput = {
  workspacePath: string
  configHomeDir?: string
  relativePath: string
}

export type ResetProjectMemoryInput = {
  workspacePath: string
  configHomeDir?: string
  includeRecallLog: boolean
}

export type DesktopMemoryRecallFile = {
  relativePath: string
  type?: MemoryType
  description?: string | null
  mtimeMs?: number
  truncated?: boolean
}

export type DesktopMemoryRecallEvent = {
  sessionId: string
  createdAt: string
  querySummary: string
  status: 'injected' | 'viewed'
  consumedOnIteration: number
  memories: DesktopMemoryRecallFile[]
}

export function getProjectMemoryPaths(
  workspacePath: string,
  configHomeDir = defaultConfigHomeDir(),
): { memoryDir: string; entrypointPath: string; recallLogPath: string } {
  const paths = resolveAutoMemoryPaths({
    configHomeDir,
    homeDir: homedir(),
    projectRoot: workspacePath,
  })
  return {
    memoryDir: paths.autoMemPath,
    entrypointPath: paths.entrypointPath,
    recallLogPath: join(paths.autoMemPath, RECALL_LOG_NAME),
  }
}

export async function listProjectMemories(
  workspacePath: string,
  configHomeDir?: string,
): Promise<DesktopProjectMemoryListing> {
  const paths = getProjectMemoryPaths(workspacePath, configHomeDir)
  const files = await listMarkdownFiles(paths.memoryDir)
  const memories = await Promise.all(files.map(file => readMemoryMetadata(paths.memoryDir, file)))
  return {
    memoryDir: paths.memoryDir,
    entrypointPath: paths.entrypointPath,
    memories: memories.sort((a, b) => b.mtimeMs - a.mtimeMs),
  }
}

export async function readProjectMemory(
  workspacePath: string,
  configHomeDir: string | undefined,
  relativePath: string,
): Promise<DesktopProjectMemory & { content: string }> {
  const paths = getProjectMemoryPaths(workspacePath, configHomeDir)
  const absolutePath = resolveMemoryFilePath(paths.memoryDir, relativePath)
  const [content, metadata] = await Promise.all([
    readFile(absolutePath, 'utf8'),
    readMemoryMetadata(paths.memoryDir, relativePath),
  ])
  return { ...metadata, content }
}

export async function saveProjectMemory(
  input: SaveProjectMemoryInput,
): Promise<DesktopProjectMemory> {
  const paths = getProjectMemoryPaths(input.workspacePath, input.configHomeDir)
  const absolutePath = resolveMemoryFilePath(paths.memoryDir, input.relativePath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, input.content, 'utf8')
  return readMemoryMetadata(paths.memoryDir, input.relativePath)
}

export async function deleteProjectMemory(
  input: DeleteProjectMemoryInput,
): Promise<void> {
  const paths = getProjectMemoryPaths(input.workspacePath, input.configHomeDir)
  await rm(resolveMemoryFilePath(paths.memoryDir, input.relativePath), { force: true })
}

export async function resetProjectMemory(
  input: ResetProjectMemoryInput,
): Promise<void> {
  const paths = getProjectMemoryPaths(input.workspacePath, input.configHomeDir)
  if (!input.includeRecallLog) {
    await rm(paths.entrypointPath, { force: true })
    const files = await listMarkdownFiles(paths.memoryDir)
    await Promise.all(files.map(file => rm(resolveMemoryFilePath(paths.memoryDir, file), { force: true })))
    return
  }
  await rm(paths.memoryDir, { recursive: true, force: true })
}

export async function listProjectMemoryRecalls(
  workspacePath: string,
  configHomeDir?: string,
): Promise<{ recallLogPath: string; recalls: DesktopMemoryRecallEvent[] }> {
  const paths = getProjectMemoryPaths(workspacePath, configHomeDir)
  try {
    const raw = await readFile(paths.recallLogPath, 'utf8')
    const recalls = raw
      .split(/\r?\n/)
      .filter(line => line.trim().length > 0)
      .flatMap(parseRecallEvent)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { recallLogPath: paths.recallLogPath, recalls }
  } catch {
    return { recallLogPath: paths.recallLogPath, recalls: [] }
  }
}

async function listMarkdownFiles(memoryDir: string): Promise<string[]> {
  try {
    const entries = await readdir(memoryDir, { recursive: true, withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md') && entry.name !== ENTRYPOINT_NAME)
      .map(entry => normalize(relative(memoryDir, join(entry.parentPath, entry.name))))
  } catch {
    return []
  }
}

async function readMemoryMetadata(
  memoryDir: string,
  relativePath: string,
): Promise<DesktopProjectMemory> {
  const absolutePath = resolveMemoryFilePath(memoryDir, relativePath)
  const [fileStat, content] = await Promise.all([
    stat(absolutePath),
    readFile(absolutePath, 'utf8').catch(() => ''),
  ])
  const frontmatter = parseFrontmatter(content)
  return {
    relativePath: normalize(relativePath),
    absolutePath,
    type: parseMemoryType(frontmatter.type),
    description: typeof frontmatter.description === 'string' ? frontmatter.description : null,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
  }
}

function resolveMemoryFilePath(memoryDir: string, rawRelativePath: string): string {
  if (
    !rawRelativePath ||
    rawRelativePath.includes('\0') ||
    isAbsolute(rawRelativePath) ||
    basename(rawRelativePath) === ENTRYPOINT_NAME ||
    !rawRelativePath.endsWith('.md')
  ) {
    throw new Error('Invalid memory path')
  }
  const resolved = resolve(memoryDir, rawRelativePath)
  const root = memoryDir.endsWith(sep) ? memoryDir : `${memoryDir}${sep}`
  if (!resolved.startsWith(root)) {
    throw new Error('Invalid memory path')
  }
  return resolved
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const end = content.indexOf('\n---', 3)
  if (end < 0) return {}
  const body = content.slice(3, end)
  const values: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return values
}

function parseRecallEvent(line: string): DesktopMemoryRecallEvent[] {
  try {
    const parsed = JSON.parse(line) as Partial<DesktopMemoryRecallEvent>
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.querySummary !== 'string' ||
      (parsed.status !== 'injected' && parsed.status !== 'viewed') ||
      typeof parsed.consumedOnIteration !== 'number' ||
      !Array.isArray(parsed.memories)
    ) {
      return []
    }
    return [parsed as DesktopMemoryRecallEvent]
  } catch {
    return []
  }
}

function defaultConfigHomeDir(): string {
  return process.env.CODEPILOTX_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}
