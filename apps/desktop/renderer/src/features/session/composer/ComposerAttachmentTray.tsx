import { FileText, Image, X } from 'lucide-react'
import type { DesktopComposerAttachment } from '../../../../shared/types.js'
import type { CSSProperties } from 'react'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
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
  if (attachments.length === 0) return null

  return (
    <div
      aria-label="已添加附件"
      className="composer-attachments tw:mb-2 tw:flex tw:flex-wrap tw:items-start tw:gap-2"
    >
      {attachments.map((attachment) => {
        const previewable = resolveDraftAttachmentPreviewContent(attachment) !== null
        const content = (
          <>
            <span className="composer-attachment-preview">
              {attachment.kind === 'image' && attachment.previewDataUrl ? (
                <img
                  alt={attachment.name}
                  className="composer-attachment-thumbnail"
                  src={attachment.previewDataUrl}
                />
              ) : (
                <span className="composer-attachment-file-icon">
                  {attachment.kind === 'image' ? (
                    <Image size={APP_ICON_SIZE} />
                  ) : (
                    <FileText size={APP_ICON_SIZE} />
                  )}
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
          </>
        )
        return (
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
            {previewable ? (
              <Button
                aria-label={`预览 ${attachment.name}`}
                className="composer-attachment-open"
                onClick={() => onOpen?.(attachment)}
                style={attachmentOpenStyle}
              >
                {content}
              </Button>
            ) : (
              <span
                className="composer-attachment-open composer-attachment-open--disabled"
                style={attachmentOpenStyle}
              >
                {content}
              </span>
            )}
            <IconButton
              className="composer-attachment-remove"
              onClick={event => {
                event.stopPropagation()
                onRemove?.(attachment.id)
              }}
              size="sm"
              title="移除附件"
              variant="plain"
            >
              <X size={12} strokeWidth={2.25} />
            </IconButton>
          </div>
        )
      })}
    </div>
  )
}

const attachmentOpenStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  width: '100%',
  height: '100%',
  minHeight: 0,
  alignItems: 'stretch',
  padding: 0,
  border: 0,
  borderRadius: 'inherit',
  background: 'transparent',
  color: 'inherit',
  overflow: 'hidden',
  textAlign: 'left',
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
