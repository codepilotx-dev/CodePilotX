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

  // Handle skill invocation: wrap the skill info so the runtime's SkillTool
  // can process it naturally alongside the user's text.
  const skillPrefix = input.skillInvocation
    ? formatSkillInvocation(input.skillInvocation)
    : ''

  const combinedText = [skillPrefix, text].filter(Boolean).join('\n\n')

  if (attachments.length === 0) {
    return combinedText || text
  }

  const blocks: ContentBlockParam[] = []
  if (combinedText) {
    blocks.push({ type: 'text', text: combinedText })
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
  const skillInfo = input.skillInvocation
    ? `[skill: ${input.skillInvocation.name}]`
    : ''
  const parts = [skillInfo, text]
  if (attachments.length > 0) {
    const attachmentSummary = attachments
      .map(attachment => `[${attachment.name}]`)
      .join(' ')
    parts.push(attachmentSummary)
  }
  return parts.filter(Boolean).join(' ')
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

function formatSkillInvocation(invocation: {
  name: string
  args?: string
  skillPath?: string
}): string {
  const skillRef = invocation.skillPath
    ? `[${invocation.name}](${invocation.skillPath})`
    : invocation.name
  const args = invocation.args ? ` ${invocation.args}` : ''
  return `/${skillRef}${args}`
}
