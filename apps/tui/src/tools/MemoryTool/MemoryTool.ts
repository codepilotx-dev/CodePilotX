import { dirname, extname, join, normalize, relative, resolve, sep } from 'path'
import { z } from 'zod/v4'
import { logEvent } from '@codepilotx/tui/services/analytics/index.js'
import type { ToolUseContext } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { getSessionId } from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'
import { isENOENT } from '../../utils/errors.js'
import { getFileModificationTime, writeTextContent } from '../../utils/file.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { appendMemoryRecallEvent } from '../../utils/memoryRecallLog.js'
import {
  MEMORIES_VIRTUAL_ROOT,
  MEMORY_MAX_LIST_ITEMS,
  MEMORY_TOOL_NAME,
  MEMORY_VIEW_DEFAULT_LINES,
  MEMORY_VIEW_DEFAULT_BYTES,
} from './constants.js'
import { getMemoryToolPrompt } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'

const memoryCommands = z.enum([
  'view',
  'create',
  'str_replace',
  'insert',
  'delete',
  'rename',
])

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: memoryCommands.describe('The operation to perform'),
    path: z.string().describe('Virtual path under /memories'),
    file_text: z
      .string()
      .optional()
      .describe('File content for create command'),
    old_str: z
      .string()
      .optional()
      .describe('Text to replace (str_replace)'),
    new_str: z
      .string()
      .optional()
      .describe('Replacement text (str_replace/insert)'),
    insert_line: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Line number to insert after (0 = file start)'),
    new_path: z
      .string()
      .optional()
      .describe('Target path for rename'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Starting line for view (0-based)'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Max lines to read'),
  }),
)
type Input = z.infer<ReturnType<typeof inputSchema>>

type Output = {
  command: string
  path: string
  content?: string
  contentTruncated?: boolean
  files?: Array<{
    path: string
    type?: string
    description?: string
  }>
  totalFiles?: number
}

function getRealPath(virtualPath: string): string | null {
  if (!virtualPath.startsWith(MEMORIES_VIRTUAL_ROOT)) return null

  const autoMemPath = getAutoMemPath()
  const relativePart = virtualPath.slice(MEMORIES_VIRTUAL_ROOT.length)

  if (relativePart === '' || relativePart === '/') {
    return autoMemPath
  }

  // Ensure path does not end with trailing separator
  const normalizedRoot = normalize(autoMemPath).replace(/[/\\]+$/, '')

  // SECURITY checks
  if (!relativePart.startsWith('/')) return null
  if (relativePart.includes('..')) return null
  if (relativePart.includes('\\')) return null
  if (relativePart.includes('\0')) return null
  if (relativePart.includes('~')) return null

  const cleanPath = relativePart.slice(1)
  const resolved = resolve(normalizedRoot, cleanPath)
  const normalized = normalize(resolved)

  if (!normalized.startsWith(normalizedRoot + sep) && normalized !== normalizedRoot) {
    return null
  }

  return normalized
}

function validateMutationPath(virtualPath: string): string {
  const realPath = getRealPath(virtualPath)
  if (!realPath) {
    throw new Error(`Invalid path: ${virtualPath}. Must be under ${MEMORIES_VIRTUAL_ROOT}`)
  }
  if (realPath === getAutoMemPath()) {
    throw new Error(`Cannot mutate the root ${MEMORIES_VIRTUAL_ROOT} directory`)
  }
  if (extname(realPath) !== '.md') {
    throw new Error('Mutation operations only support .md files')
  }
  return realPath
}

function validateViewPath(virtualPath: string): string {
  const realPath = getRealPath(virtualPath)
  if (!realPath) {
    throw new Error(`Invalid path: ${virtualPath}. Must be under ${MEMORIES_VIRTUAL_ROOT}`)
  }
  return realPath
}

function virtualFromReal(realPath: string): string {
  const autoMemPath = getAutoMemPath()
  if (realPath === normalize(autoMemPath)) return MEMORIES_VIRTUAL_ROOT
  const rel = relative(autoMemPath, realPath)
  return `${MEMORIES_VIRTUAL_ROOT}/${rel.replace(/\\/g, '/')}`
}

function parseFrontmatter(
  content: string,
): { type?: string; description?: string } {
  if (!content.startsWith('---')) return {}
  const end = content.indexOf('\n---', 3)
  if (end < 0) return {}
  const body = content.slice(3, end)
  const values: { type?: string; description?: string } = {}
  for (const line of body.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (key === 'type') values.type = val
    if (key === 'description') values.description = val
  }
  return values
}

async function writeRecallViewed(
  realPath: string,
  content: string,
  toolUseContext: ToolUseContext,
): Promise<void> {
  const autoMemPath = getAutoMemPath()
  const lastUserMessage = toolUseContext.messages.findLast(
    m => m.type === 'user' && !(m as any).isMeta,
  )
  const query = lastUserMessage && 'message' in lastUserMessage && 'content' in (lastUserMessage as any).message
    ? String((lastUserMessage as any).message.content)
    : 'memory view'

  void appendMemoryRecallEvent({
    memoryDir: autoMemPath,
    sessionId: getSessionId(),
    query,
    consumedOnIteration: 0,
    memories: [
      {
        path: realPath,
        content,
        mtimeMs: Date.now(),
        header: `Memory (viewed): ${realPath}:`,
        limit: undefined,
      },
    ],
  }).catch((error: Error) => {
    logForDebugging(`[memory-tool] failed to write recall log: ${error}`, {
      level: 'debug',
    })
  })
}

export const MemoryTool = buildTool({
  name: MEMORY_TOOL_NAME,
  searchHint: 'view and manage persistent memory files',
  maxResultSizeChars: 100_000,
  alwaysLoad: true,
  async description() {
    return 'A tool for viewing and managing persistent memory files'
  },
  async prompt() {
    return getMemoryToolPrompt()
  },
  userFacingName,
  getToolUseSummary,
  get inputSchema() {
    return inputSchema()
  },
  isEnabled: () => isAutoMemoryEnabled(),
  isReadOnly(input) {
    return input.command === 'view'
  },
  isDestructive(input) {
    return input.command === 'delete'
  },
  toAutoClassifierInput(input) {
    return `${input.command} ${input.path}`
  },
  inputsEquivalent(a, b) {
    return a.command === b.command && a.path === b.path
  },
  async validateInput(input: Input) {
    try {
      switch (input.command) {
        case 'view':
          if (input.path !== MEMORIES_VIRTUAL_ROOT && !input.path.startsWith(MEMORIES_VIRTUAL_ROOT + '/')) {
            return { result: false, message: `Path must start with ${MEMORIES_VIRTUAL_ROOT}`, errorCode: 1 }
          }
          validateViewPath(input.path)
          return { result: true }

        case 'create':
          if (!input.file_text) {
            return { result: false, message: 'file_text is required for create', errorCode: 1 }
          }
          validateMutationPath(input.path)
          return { result: true }

        case 'str_replace':
          if (!input.old_str) {
            return { result: false, message: 'old_str is required for str_replace', errorCode: 1 }
          }
          if (!input.new_str) {
            return { result: false, message: 'new_str is required for str_replace', errorCode: 1 }
          }
          validateMutationPath(input.path)
          return { result: true }

        case 'insert':
          if (input.insert_line === undefined) {
            return { result: false, message: 'insert_line is required for insert', errorCode: 1 }
          }
          if (!input.new_str) {
            return { result: false, message: 'new_str is required for insert', errorCode: 1 }
          }
          validateMutationPath(input.path)
          return { result: true }

        case 'delete':
          validateMutationPath(input.path)
          return { result: true }

        case 'rename':
          if (!input.new_path) {
            return { result: false, message: 'new_path is required for rename', errorCode: 1 }
          }
          if (input.new_path === input.path) {
            return { result: false, message: 'new_path must be different from path', errorCode: 1 }
          }
          validateMutationPath(input.path)
          validateMutationPath(input.new_path)
          return { result: true }

        default:
          return { result: true }
      }
    } catch (e) {
      return { result: false, message: (e as Error).message, errorCode: 1 }
    }
  },
  async call(input: Input, context: ToolUseContext) {
    const fs = getFsImplementation()
    const autoMemPath = getAutoMemPath()

    switch (input.command) {
      case 'view': {
        const realPath = validateViewPath(input.path)

        if (realPath === autoMemPath || realPath === normalize(autoMemPath)) {
          // List directory contents
          const entries: Array<{ name: string; path: string; type?: string; description?: string }> = []
          let dirents: { name: string; isFile(): boolean }[]
          try {
            dirents = await fs.readdir(autoMemPath)
          } catch {
            dirents = []
          }

          for (const dirent of dirents) {
            if (entries.length >= MEMORY_MAX_LIST_ITEMS) break
            if (!dirent.isFile()) continue
            if (!dirent.name.endsWith('.md')) continue
            const fullPath = join(autoMemPath, dirent.name)

            let type: string | undefined
            let description: string | undefined
            try {
              const content = await fs.readFileBytes(fullPath)
              const text = content.toString('utf8')
              const fm = parseFrontmatter(text)
              type = fm.type
              description = fm.description
            } catch {
              // skip frontmatter parsing on error
            }

            entries.push({
              name: dirent.name,
              path: virtualFromReal(fullPath),
              type,
              description,
            })
          }

          entries.sort((a, b) => a.name.localeCompare(b.name))

          return {
            data: {
              command: 'view',
              path: MEMORIES_VIRTUAL_ROOT,
              files: entries,
              totalFiles: entries.length,
            } satisfies Output,
          }
        }

        // Single file read
        const maxLines = input.limit ?? MEMORY_VIEW_DEFAULT_LINES
        const maxBytes = MEMORY_VIEW_DEFAULT_BYTES

        let content: string
        let totalLines = 0
        let contentTruncated = false

        try {
          const fileBuffer = await fs.readFileBytes(realPath)
          content = fileBuffer.toString('utf8').replaceAll('\r\n', '\n')
          totalLines = content.split('\n').length

          const offset = input.offset ?? 0
          if (offset > 0 || maxLines < totalLines) {
            const lines = content.split('\n')
            const sliced = lines.slice(offset, offset + maxLines)
            content = sliced.join('\n')
            contentTruncated = offset + maxLines < totalLines
          }

          if (Buffer.byteLength(content, 'utf8') > maxBytes) {
            const truncated = content.slice(0, maxBytes)
            const lastNewline = truncated.lastIndexOf('\n')
            content = truncated.slice(0, lastNewline > 0 ? lastNewline : maxBytes)
            contentTruncated = true
          }

          // Update readFileState so subsequent Edit can detect staleness
          context.readFileState.set(realPath, {
            content,
            timestamp: getFileModificationTime(realPath),
            offset: input.offset,
            limit: input.limit,
            isPartialView: input.offset !== undefined || input.limit !== undefined,
          })
        } catch (e) {
          if (isENOENT(e)) {
            return {
              data: {
                command: 'view',
                path: input.path,
                content: `File not found: ${input.path}`,
              } satisfies Output,
            }
          }
          throw e
        }

        // Write recall event for viewed memory
        void writeRecallViewed(realPath, content, context)

        const resultContent = contentTruncated
          ? `${content}\n\n>[View truncated. Read more with offset=${(input.offset ?? 0) + maxLines}.]`
          : content

        return {
          data: {
            command: 'view',
            path: input.path,
            content: resultContent,
            contentTruncated,
          } satisfies Output,
        }
      }

      case 'create': {
        const realPath = validateMutationPath(input.path)

        // Check file doesn't already exist
        try {
          await fs.stat(realPath)
          return {
            data: {
              command: 'create',
              path: input.path,
              content: `File already exists: ${input.path}. Use str_replace or rename instead.`,
            } satisfies Output,
          }
        } catch (e) {
          if (!isENOENT(e)) throw e
        }

        await fs.mkdir(dirname(realPath))
        writeTextContent(realPath, input.file_text!, 'utf8', 'LF')

        logEvent('tengu_memory_tool_create', {
          path: virtualFromReal(realPath),
        })

        return {
          data: {
            command: 'create',
            path: input.path,
            content: `Created memory file: ${input.path}`,
          } satisfies Output,
        }
      }

      case 'str_replace': {
        const realPath = validateMutationPath(input.path)
        const { old_str, new_str } = input

        let fileContent: string
        try {
          const buf = await fs.readFileBytes(realPath)
          fileContent = buf.toString('utf8').replaceAll('\r\n', '\n')
        } catch (e) {
          if (isENOENT(e)) {
            return {
              data: {
                command: 'str_replace',
                path: input.path,
                content: `File not found: ${input.path}`,
              } satisfies Output,
            }
          }
          throw e
        }

        const occurrences = fileContent.split(old_str!).length - 1
        if (occurrences === 0) {
          return {
            data: {
              command: 'str_replace',
              path: input.path,
              content: `String to replace not found in ${input.path}`,
            } satisfies Output,
          }
        }
        if (occurrences > 1) {
          return {
            data: {
              command: 'str_replace',
              path: input.path,
              content: `Found ${occurrences} matches of the string to replace. Provide more context to uniquely identify the instance.`,
            } satisfies Output,
          }
        }

        const updatedContent = fileContent.replace(old_str!, new_str!)
        writeTextContent(realPath, updatedContent, 'utf8', 'LF')

        context.readFileState.set(realPath, {
          content: updatedContent,
          timestamp: getFileModificationTime(realPath),
          offset: undefined,
          limit: undefined,
        })

        logEvent('tengu_memory_tool_update', {
          path: virtualFromReal(realPath),
          operation: 'str_replace',
        })

        return {
          data: {
            command: 'str_replace',
            path: input.path,
            content: `Updated ${input.path}`,
          } satisfies Output,
        }
      }

      case 'insert': {
        const realPath = validateMutationPath(input.path)
        const { insert_line, new_str } = input

        let fileContent: string
        try {
          const buf = await fs.readFileBytes(realPath)
          fileContent = buf.toString('utf8').replaceAll('\r\n', '\n')
        } catch (e) {
          if (isENOENT(e)) {
            return {
              data: {
                command: 'insert',
                path: input.path,
                content: `File not found: ${input.path}`,
              } satisfies Output,
            }
          }
          throw e
        }

        const lines = fileContent.split('\n')
        const insertAt = Math.min(insert_line!, lines.length)
        lines.splice(insertAt, 0, new_str!)
        const updatedContent = lines.join('\n')
        writeTextContent(realPath, updatedContent, 'utf8', 'LF')

        context.readFileState.set(realPath, {
          content: updatedContent,
          timestamp: getFileModificationTime(realPath),
          offset: undefined,
          limit: undefined,
        })

        logEvent('tengu_memory_tool_update', {
          path: virtualFromReal(realPath),
          operation: 'insert',
        })

        return {
          data: {
            command: 'insert',
            path: input.path,
            content: `Updated ${input.path}`,
          } satisfies Output,
        }
      }

      case 'delete': {
        const realPath = validateMutationPath(input.path)

        try {
          await fs.rm(realPath)
        } catch (e) {
          if (isENOENT(e)) {
            return {
              data: {
                command: 'delete',
                path: input.path,
                content: `File not found: ${input.path}`,
              } satisfies Output,
            }
          }
          throw e
        }

        logEvent('tengu_memory_tool_delete', {
          path: virtualFromReal(realPath),
        })

        return {
          data: {
            command: 'delete',
            path: input.path,
            content: `Deleted ${input.path}`,
          } satisfies Output,
        }
      }

      case 'rename': {
        const srcReal = validateMutationPath(input.path)
        const dstReal = validateMutationPath(input.new_path!)

        // Check target doesn't already exist
        try {
          await fs.stat(dstReal)
          return {
            data: {
              command: 'rename',
              path: input.path,
              content: `Target already exists: ${input.new_path}`,
            } satisfies Output,
          }
        } catch (e) {
          if (!isENOENT(e)) throw e
        }

        try {
          await fs.stat(srcReal)
        } catch (e) {
          if (isENOENT(e)) {
            return {
              data: {
                command: 'rename',
                path: input.path,
                content: `Source file not found: ${input.path}`,
              } satisfies Output,
            }
          }
          throw e
        }

        await fs.mkdir(dirname(dstReal))
        await fs.rename(srcReal, dstReal)

        logEvent('tengu_memory_tool_rename', {
          from: virtualFromReal(srcReal),
          to: virtualFromReal(dstReal),
        })

        return {
          data: {
            command: 'rename',
            path: input.path,
            content: `Renamed ${input.path} to ${input.new_path}`,
          } satisfies Output,
        }
      }

      default:
        return {
          data: {
            command: input.command,
            path: input.path,
            content: `Unknown command: ${input.command}`,
          } satisfies Output,
        }
    }
  },
  mapToolResultToToolResultBlockParam(data: Output, toolUseID) {
    let content: string

    switch (data.command) {
      case 'view':
        if (data.files) {
          const lines = data.files.map(
            f =>
              `${f.path}${f.type ? ` (type: ${f.type})` : ''}${f.description ? ` — ${f.description}` : ''}`,
          )
          content = `Memory directory listing (${data.totalFiles} files):\n${lines.join('\n')}`
        } else {
          content = data.content ?? ''
        }
        break
      default:
        content = data.content ?? ''
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseErrorMessage,
} satisfies ToolDef<ReturnType<typeof inputSchema>, Output>)


