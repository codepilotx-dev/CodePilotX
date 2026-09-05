import type { DesktopComposerAttachment } from '../../../../shared/types.js'
import {
  AttachmentFilePill,
  AttachmentHorizontalRow,
  AttachmentImageTile,
} from '../attachments/AttachmentRowPrimitives.js'
import { resolveDraftAttachmentPreviewContent } from '../attachments/attachmentPreviewSupport.js'

type Props = {
  attachments: DesktopComposerAttachment[]
  onOpen?: (attachment: DesktopComposerAttachment) => void
  onRemove?: (attachmentId: string) => void
}

export function ComposerAttachmentTray({
  attachments,
  onOpen,
  onRemove,
}: Props): React.ReactNode {
  const images = attachments.filter(attachment => attachment.kind === 'image')
  const files = attachments.filter(attachment => attachment.kind !== 'image')

  if (attachments.length === 0) return null

  return (
    <div aria-label="已添加附件" className="composer-attachments">
      {images.length > 0 ? (
        <AttachmentHorizontalRow ariaLabel="已添加图片">
          {images.map(attachment => {
            const previewable = resolveDraftAttachmentPreviewContent(attachment) !== null
            return (
              <AttachmentImageTile
                errorMessage={attachment.error}
                key={attachment.id}
                name={attachment.name}
                onOpen={previewable && onOpen ? () => onOpen(attachment) : undefined}
                onRemove={onRemove ? () => onRemove(attachment.id) : undefined}
                source={attachment.previewDataUrl}
                status={attachment.status === 'error' ? 'error' : 'ready'}
              />
            )
          })}
        </AttachmentHorizontalRow>
      ) : null}
      {files.length > 0 ? (
        <AttachmentHorizontalRow ariaLabel="已添加文件">
          {files.map(attachment => {
            const previewable = resolveDraftAttachmentPreviewContent(attachment) !== null
            return (
              <AttachmentFilePill
                detail={attachment.error ?? attachmentTypeLabel(attachment)}
                error={attachment.status === 'error'}
                key={attachment.id}
                name={attachment.name}
                onOpen={previewable && onOpen ? () => onOpen(attachment) : undefined}
                onRemove={onRemove ? () => onRemove(attachment.id) : undefined}
              />
            )
          })}
        </AttachmentHorizontalRow>
      ) : null}
    </div>
  )
}

function attachmentTypeLabel(attachment: DesktopComposerAttachment): string {
  const extension = attachment.name.split('.').pop()
  if (extension && extension !== attachment.name) return extension.toUpperCase()
  switch (attachment.kind) {
    case 'document':
      return 'DOCUMENT'
    case 'text':
      return 'TEXT'
    case 'audio':
      return 'AUDIO'
    case 'video':
      return 'VIDEO'
    default:
      return 'FILE'
  }
}
