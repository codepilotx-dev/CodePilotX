import type { Attachment } from '@codepilotx/shared/thread'
import type { DesktopComposerAttachment } from '../../../../shared/types.js'
import type { UserAttachmentPreviewTab } from '../../layout/dock/rightDockState.js'
import { resolveDraftAttachmentPreviewContent } from './attachmentPreviewSupport.js'

export function createThreadAttachmentPreviewTab(
  attachment: Attachment,
): UserAttachmentPreviewTab | null {
  if (attachment.kind !== 'image' && attachment.kind !== 'text') return null
  return {
    id: 'user-attachment-preview',
    kind: 'attachment-preview',
    attachment: {
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
    },
    source: { storage: 'thread', attachmentId: attachment.id },
  }
}

export function createDraftAttachmentPreviewTab(
  attachment: DesktopComposerAttachment,
): UserAttachmentPreviewTab | null {
  const content = resolveDraftAttachmentPreviewContent(attachment)
  return content
    ? createDraftTab(
        attachment,
        content.kind,
        content.data,
        content.encoding,
      )
    : null
}

export function canPreviewDraftAttachment(
  attachment: DesktopComposerAttachment,
): boolean {
  return createDraftAttachmentPreviewTab(attachment) !== null
}

function createDraftTab(
  attachment: DesktopComposerAttachment,
  kind: 'image' | 'text',
  data: string,
  encoding: 'base64' | 'utf8',
): UserAttachmentPreviewTab {
  return {
    id: 'user-attachment-preview',
    kind: 'attachment-preview',
    attachment: {
      id: attachment.id,
      kind,
      name: attachment.name,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
    },
    source: { storage: 'draft', data, encoding },
  }
}
