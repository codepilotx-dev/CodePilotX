import type {
  Attachment,
  AttachmentKind,
} from '@codepilotx/core/attachments/types.js'
import type {
  DesktopComposerAttachment,
  DesktopUserMessageInput,
  DesktopUserMessageContent,
} from './types.js'

export function hasBlockingComposerAttachmentErrors(
  attachments: DesktopComposerAttachment[] | undefined,
): boolean {
  return (attachments ?? []).some(attachment => attachment.status === 'error')
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

/**
 * Convert a UI-rich DesktopComposerAttachment to the neutral Attachment
 * type used across the protocol and runtime boundary.
 *
 * Strips UI-only fields (id, status, error, previewDataUrl, truncated).
 */
export function desktopAttachmentToAttachment(
  input: DesktopComposerAttachment,
): Attachment {
  return {
    kind: input.kind as AttachmentKind,
    name: input.name,
    path: input.path,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
    contentBase64: input.contentBase64,
    textContent: input.textContent,
  }
}

/**
 * Convert a DesktopUserMessageInput (with UI-rich attachments) to the
 * neutral DesktopUserMessageContent (with core Attachment[]).
 *
 * This is the replacement for the old `buildDesktopUserMessageContent`
 * which produced Anthropic ContentBlockParam[].
 */
export function buildDesktopUserMessageContent(
  input: DesktopUserMessageInput,
): DesktopUserMessageContent {
  const text = input.text.trim()

  // Handle skill invocation: wrap the skill info so the runtime's SkillTool
  // can process it naturally alongside the user's text.
  const skillPrefix = input.skillInvocation
    ? formatSkillInvocation(input.skillInvocation)
    : ''

  const combinedText = [skillPrefix, text].filter(Boolean).join('\n\n')

  return {
    text: combinedText,
    attachments: (input.attachments ?? [])
      .filter(a => a.status !== 'error')
      .map(desktopAttachmentToAttachment),
  }
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
