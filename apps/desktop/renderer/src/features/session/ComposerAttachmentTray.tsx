import { FileText, X } from 'lucide-react'
import type { DesktopComposerAttachment } from '../../../shared/types.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'

type Props = {
  attachments: DesktopComposerAttachment[]
  onRemove?: (attachmentId: string) => void
}

export function ComposerAttachmentTray({
  attachments,
  onRemove,
}: Props): React.ReactNode {
  if (attachments.length === 0) return null

  return (
    <div
      aria-label="已添加附件"
      className="composer-attachments tw:mb-2 tw:flex tw:flex-wrap tw:items-start tw:gap-2"
    >
      {attachments.map((attachment) => (
        <div
          className={[
            'composer-attachment-card',
            'tw:relative tw:inline-flex tw:size-20 tw:min-w-0 tw:items-stretch tw:overflow-visible',
            `composer-attachment-${attachment.kind}`,
            attachment.status,
            attachment.status === 'error' ? 'error' : '',
          ].join(' ')}
          key={attachment.id}
          title={attachment.error ?? attachment.path}
        >
          <span className="composer-attachment-preview">
            {attachment.kind === 'image' && attachment.previewDataUrl ? (
              <img
                alt={attachment.name}
                className="composer-attachment-thumbnail"
                src={attachment.previewDataUrl}
              />
            ) : (
              <span className="composer-attachment-file-icon">
                <FileText size={APP_ICON_SIZE} />
              </span>
            )}
          </span>
          <span className="composer-attachment-body">
            <span className="composer-attachment-name">{attachment.name}</span>
            <span className="composer-attachment-meta">
              {attachment.status === 'error'
                ? attachment.error
                : attachmentTypeLabel(attachment)}
            </span>
          </span>
          <button
            aria-label={`移除 ${attachment.name}`}
            className="composer-attachment-remove"
            onClick={() => onRemove?.(attachment.id)}
            title="移除附件"
            type="button"
          >
            <X size={12} strokeWidth={2.25} />
          </button>
        </div>
      ))}
    </div>
  )
}

function attachmentTypeLabel(attachment: DesktopComposerAttachment): string {
  const extension = attachment.name.split('.').pop()
  if (extension && extension !== attachment.name) return extension.toUpperCase()
  switch (attachment.kind) {
    case 'image':
      return 'IMAGE'
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
