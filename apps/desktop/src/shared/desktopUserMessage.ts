import type {
  DesktopComposerAttachment,
  DesktopUserMessageContent,
  DesktopUserMessageInput,
} from './types.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

export function hasBlockingComposerAttachmentErrors(
  attachments: DesktopComposerAttachment[] | undefined,
): boolean {
  return (attachments ?? []).some(attachment => attachment.status === 'error')
}

export function buildDesktopUserMessageContent(
  input: DesktopUserMessageInput,
): DesktopUserMessageContent {
  const text = input.text.trim()
  const attachments = input.attachments ?? []
  if (attachments.length === 0) {
    return text
  }

  const blocks: ContentBlockParam[] = []
  if (text) {
    blocks.push({ type: 'text', text })
  }
  for (const attachment of attachments) {
    if (attachment.status === 'error') {
      continue
    }
    blocks.push(...attachmentToContentBlocks(attachment))
  }
  return blocks
}

export function desktopUserMessageInputToPreviewText(
  input: DesktopUserMessageInput,
): string {
  const text = input.text.trim()
  const attachments = input.attachments ?? []
  if (attachments.length === 0) return text
  const attachmentSummary = attachments
    .map(attachment => `[${attachment.name}]`)
    .join(' ')
  return [text, attachmentSummary].filter(Boolean).join(' ')
}

function attachmentToContentBlocks(
  attachment: DesktopComposerAttachment,
): ContentBlockParam[] {
  if (
    attachment.kind === 'image' &&
    attachment.contentBase64 &&
    attachment.mediaType
  ) {
    return [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mediaType as never,
          data: attachment.contentBase64,
        },
      },
    ]
  }

  if (
    attachment.kind === 'document' &&
    attachment.contentBase64 &&
    attachment.mediaType
  ) {
    return [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: attachment.mediaType,
          data: attachment.contentBase64,
        },
      } as ContentBlockParam,
    ]
  }

  if (attachment.kind === 'text' && attachment.textContent !== undefined) {
    return [
      {
        type: 'text',
        text: formatAttachedFileText(
          attachment,
          attachment.textContent,
        ),
      },
    ]
  }

  return [
    {
      type: 'text',
      text: formatAttachedFileText(
        attachment,
        'Binary media is attached as file metadata because this runtime does not send audio/video bytes directly.',
      ),
    },
  ]
}

function formatAttachedFileText(
  attachment: DesktopComposerAttachment,
  content: string,
): string {
  const size =
    attachment.kind === 'audio' ||
    attachment.kind === 'video' ||
    attachment.kind === 'binary'
      ? ` size="${formatFileSize(attachment.sizeBytes)}"`
      : ''
  return `<attached_file name="${escapeAttribute(attachment.name)}" media_type="${escapeAttribute(attachment.mediaType)}" path="${escapeAttribute(attachment.path)}"${size}>\n${content}\n</attached_file>`
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${trimNumber(bytes / 1000)} kB`
  return `${trimNumber(bytes / 1_000_000)} MB`
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
