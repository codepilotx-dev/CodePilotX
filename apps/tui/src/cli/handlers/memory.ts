import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { buildUserMemorySkeleton, resolveUserMemoryPaths } from '@codepilotx/core/memory/state.js'
import { cliError, cliOk } from '../exit.js'
import { scanForSecrets } from '../../services/teamMemorySync/secretScanner.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { editFileInEditor } from '../../utils/promptEditor.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

type MemoryExport = {
  memoryDir: string
  files: Array<{ relativePath: string; content: string }>
}

type ImportPayload = {
  files?: Array<{ relativePath?: unknown; content?: unknown }>
}

export async function memoryShowHandler(): Promise<never> {
  const memoryDir = await ensureUserMemoryDir()
  const files = await listUserMemoryFiles(memoryDir)
  const lines = [`User memory directory: ${memoryDir}`, ...files.map(file => `- ${file}`)]
  return cliOk(lines.join('\n'))
}

export async function memoryAddHandler(text: string): Promise<never> {
  const trimmed = text.trim()
  if (!trimmed) return cliError('Memory text cannot be empty.')
  const unsafe = rejectUnsafeMemoryContent(trimmed)
  if (unsafe) return cliError(unsafe)

  const memoryDir = await ensureUserMemoryDir()
  const event = {
    time: new Date().toISOString(),
    type: 'memory',
    key: 'manual',
    value: trimmed,
    source: 'cli memory add',
    confidence: 1,
    explicit: true,
  }
  await writeFile(
    resolveUserMemoryFilePath(memoryDir, 'memory_events.jsonl'),
    JSON.stringify(event) + '\n',
    { encoding: 'utf8', flag: 'a' },
  )
  return cliOk('Added user memory event.')
}

export async function memoryForgetHandler(text: string): Promise<never> {
  const trimmed = text.trim()
  if (!trimmed) return cliError('Forget text cannot be empty.')
  const memoryDir = await ensureUserMemoryDir()
  const event = {
    time: new Date().toISOString(),
    type: 'forget',
    key: 'manual',
    value: trimmed,
    source: 'cli memory forget',
    confidence: 1,
    explicit: true,
  }
  await writeFile(
    resolveUserMemoryFilePath(memoryDir, 'memory_events.jsonl'),
    JSON.stringify(event) + '\n',
    { encoding: 'utf8', flag: 'a' },
  )
  return cliOk('Recorded user memory forget event.')
}

export async function memoryEditHandler(relativePath = 'profile.memory.md'): Promise<never> {
  const memoryDir = await ensureUserMemoryDir()
  const filePath = resolveUserMemoryFilePath(memoryDir, relativePath)
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await readFile(filePath, 'utf8')
  } catch {
    await writeFile(filePath, '', 'utf8')
  }
  await editFileInEditor(filePath)
  return cliOk(`Opened ${relativePath}.`)
}

export async function memoryExportHandler(outputPath?: string): Promise<never> {
  const payload = await exportUserMemory()
  const text = JSON.stringify(payload, null, 2)
  if (outputPath) {
    const absolutePath = resolve(outputPath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, text + '\n', 'utf8')
    return cliOk(`Exported user memory to ${absolutePath}.`)
  }
  return cliOk(text)
}

export async function memoryImportHandler(inputPath: string): Promise<never> {
  const absolutePath = resolve(inputPath)
  const raw = await readFile(absolutePath, 'utf8')
  const parsed = JSON.parse(raw) as ImportPayload
  if (!Array.isArray(parsed.files)) {
    return cliError('Import file must contain a files array.')
  }

  const memoryDir = await ensureUserMemoryDir()
  for (const file of parsed.files) {
    if (typeof file.relativePath !== 'string' || typeof file.content !== 'string') {
      return cliError('Every imported file must include relativePath and content strings.')
    }
    const unsafe = rejectUnsafeMemoryContent(file.content)
    if (unsafe) return cliError(unsafe)
    const targetPath = resolveUserMemoryFilePath(memoryDir, file.relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, file.content, 'utf8')
  }
  return cliOk(`Imported ${parsed.files.length} user memory files.`)
}

export async function memoryEnableHandler(): Promise<never> {
  const { error } = updateSettingsForSource('userSettings', {
    autoMemoryEnabled: true,
  })
  if (error) return cliError(error.message)
  return cliOk('Memory enabled.')
}

export async function memoryDisableHandler(): Promise<never> {
  const { error } = updateSettingsForSource('userSettings', {
    autoMemoryEnabled: false,
  })
  if (error) return cliError(error.message)
  return cliOk('Memory disabled.')
}

async function exportUserMemory(): Promise<MemoryExport> {
  const memoryDir = await ensureUserMemoryDir()
  const files = await listUserMemoryFiles(memoryDir)
  const exported = await Promise.all(
    files.map(async relativePath => ({
      relativePath,
      content: await readFile(resolveUserMemoryFilePath(memoryDir, relativePath), 'utf8'),
    })),
  )
  return {
    memoryDir,
    files: exported.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  }
}

async function ensureUserMemoryDir(): Promise<string> {
  const { memoryDir } = resolveUserMemoryPaths({
    configHomeDir: getClaudeConfigHomeDir(),
  })
  await mkdir(memoryDir, { recursive: true })
  for (const file of buildUserMemorySkeleton()) {
    const filePath = resolveUserMemoryFilePath(memoryDir, file.relativePath)
    try {
      await readFile(filePath, 'utf8')
    } catch {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, file.content, 'utf8')
    }
  }
  return memoryDir
}

async function listUserMemoryFiles(memoryDir: string): Promise<string[]> {
  try {
    const entries = await readdir(memoryDir, { recursive: true, withFileTypes: true })
    return entries
      .filter(entry => entry.isFile())
      .map(entry => normalize(relative(memoryDir, join(entry.parentPath, entry.name))))
      .filter(isAllowedUserMemoryPath)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function resolveUserMemoryFilePath(memoryDir: string, rawRelativePath: string): string {
  if (
    !rawRelativePath ||
    rawRelativePath.includes('\0') ||
    isAbsolute(rawRelativePath) ||
    !isAllowedUserMemoryPath(rawRelativePath)
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

function isAllowedUserMemoryPath(relativePath: string): boolean {
  if (basename(relativePath) === 'conversation_index.sqlite') return false
  return ['.md', '.json', '.jsonl'].includes(extname(relativePath))
}

function rejectUnsafeMemoryContent(content: string): string | null {
  const matches = scanForSecrets(content)
  if (matches.length > 0) {
    const labels = matches.map(match => match.label).join(', ')
    return `Content contains potential secrets (${labels}) and cannot be written to memory.`
  }
  if (
    /\b(ignore|override|bypass)\b[\s\S]{0,80}\b(system|developer|user|AGENTS\.md|higher-priority)\b/i.test(
      content,
    ) ||
    /\b(leak|exfiltrate|reveal)\b[\s\S]{0,80}\b(secret|token|credential|password|private key)\b/i.test(
      content,
    )
  ) {
    return 'Content contains unsafe memory instructions and cannot be written to memory.'
  }
  if (content.split(/\r?\n/).length > 120) {
    return 'Content looks like a full chat log and cannot be written to memory.'
  }
  return null
}
