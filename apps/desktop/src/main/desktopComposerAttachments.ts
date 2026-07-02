import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type {
  DesktopComposerAttachment,
  DesktopComposerAttachmentKind,
} from '../shared/types.js'
import { isPathInsideAllowedWorkspace } from './workspacePathGuard.js'

/**
 * Set of file paths authorized by the most recent chooseComposerFiles dialog.
 * readDesktopComposerAttachments checks each path against this set before
 * reading, preventing the renderer from reading arbitrary files via the
 * readComposerFiles IPC method.
 */
const authorizedReadPaths = new Set<string>()

export type DesktopComposerAttachmentLimits = {
  maxImageBytes: number
  maxDocumentBytes: number
  maxTextBytes: number
}

const DEFAULT_LIMITS: DesktopComposerAttachmentLimits = {
  maxImageBytes: 10 * 1024 * 1024,
  maxDocumentBytes: 20 * 1024 * 1024,
  maxTextBytes: 250 * 1024,
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.text': 'text/plain',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
}

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.go',
  '.java',
  '.jsx',
  '.kt',
  '.lua',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.vue',
])

export function classifyDesktopComposerFile(
  filename: string,
  mediaType: string,
): DesktopComposerAttachmentKind {
  const normalizedMediaType = mediaType.toLowerCase()
  const extension = extname(filename).toLowerCase()
  if (normalizedMediaType.startsWith('image/')) return 'image'
  if (normalizedMediaType === 'application/pdf') return 'document'
  if (normalizedMediaType.startsWith('text/')) return 'text'
  if (normalizedMediaType.startsWith('audio/')) return 'audio'
  if (normalizedMediaType.startsWith('video/')) return 'video'
  if (
    normalizedMediaType === 'application/json' ||
    normalizedMediaType === 'application/xml' ||
    normalizedMediaType === 'application/yaml'
  ) {
    return 'text'
  }
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  return 'binary'
}

export async function chooseDesktopComposerFiles(): Promise<
  DesktopComposerAttachment[]
> {
  const { dialog } = await import('electron')
  const result = await dialog.showOpenDialog({
    title: 'Add photos and files',
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled) return []
  // Register dialog-selected paths as authorized for this read batch
  for (const filePath of result.filePaths) {
    authorizedReadPaths.add(filePath)
  }
  return readDesktopComposerAttachments(result.filePaths)
}

/**
 * Register file paths that should be authorized for the next
 * readDesktopComposerAttachments call. Used by the drag-and-drop path so that
 * the renderer can grant authorization via IPC before requesting file content.
 */
export function authorizeComposerFilePaths(filePaths: string[]): void {
  for (const filePath of filePaths) {
    authorizedReadPaths.add(filePath)
  }
}

export async function readDesktopComposerAttachments(
  filePaths: string[],
): Promise<DesktopComposerAttachment[]> {
  // Every path must be authorized (from dialog, drag-drop, or inside workspace)
  for (const filePath of filePaths) {
    if (!authorizedReadPaths.has(filePath) && !isPathInsideAllowedWorkspace(filePath)) {
      throw new Error(
        `File path not authorized: ${filePath}. Use chooseComposerFiles or authorizeComposerFilePaths first.`,
      )
    }
  }
  // Clear authorization set after use (one-shot tokens)
  authorizedReadPaths.clear()
  return Promise.all(
    filePaths.map(filePath => readDesktopComposerAttachment(filePath)),
  )
}

export async function readDesktopComposerAttachment(
  filePath: string,
  limits: Partial<DesktopComposerAttachmentLimits> = {},
): Promise<DesktopComposerAttachment> {
  const finalLimits = { ...DEFAULT_LIMITS, ...limits }
  const stats = await stat(filePath)
  const name = basename(filePath)
  const mediaType = getMediaType(name)
  const kind = classifyDesktopComposerFile(name, mediaType)
  const base = {
    id: randomUUID(),
    name,
    path: filePath,
    mediaType,
    sizeBytes: stats.size,
    kind,
  } satisfies Omit<DesktopComposerAttachment, 'status'>

  if (kind === 'image') {
    if (stats.size > finalLimits.maxImageBytes) {
      return createErrorAttachment(base, 'File is too large for image input.')
    }
    const contentBase64 = (await readFile(filePath)).toString('base64')
    return {
      ...base,
      status: 'ready',
      contentBase64,
      previewDataUrl: `data:${mediaType};base64,${contentBase64}`,
    }
  }

  if (kind === 'document') {
    if (stats.size > finalLimits.maxDocumentBytes) {
      return createErrorAttachment(base, 'File is too large for document input.')
    }
    return {
      ...base,
      status: 'ready',
      contentBase64: (await readFile(filePath)).toString('base64'),
    }
  }

  if (kind === 'text') {
    const content = await readFile(filePath, 'utf8')
    const tooLarge = Buffer.byteLength(content, 'utf8') > finalLimits.maxTextBytes
    return {
      ...base,
      status: 'ready',
      textContent: tooLarge
        ? `${content.slice(0, finalLimits.maxTextBytes)}\n\n[Attachment text truncated because it exceeds ${finalLimits.maxTextBytes} bytes.]`
        : content,
      truncated: tooLarge || undefined,
    }
  }

  return {
    ...base,
    status: 'ready',
  }
}

function createErrorAttachment(
  base: Omit<DesktopComposerAttachment, 'status'>,
  error: string,
): DesktopComposerAttachment {
  return {
    ...base,
    status: 'error',
    error,
  }
}

function getMediaType(filename: string): string {
  const extension = extname(filename).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}
