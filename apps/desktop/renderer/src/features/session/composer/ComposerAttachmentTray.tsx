import React from 'react'
import type { DesktopComposerAttachment } from '../../../../shared/types.js'
import { resolveDraftAttachmentPreviewContent } from '../attachments/attachmentPreviewSupport.js'
import {
  AlertCircle,
  Box,
  FileSpreadsheet,
  FileText,
  Music,
  Presentation,
  Video,
  X,
} from 'lucide-react'

type Props = {
  attachments: DesktopComposerAttachment[]
  onOpen?: (attachment: DesktopComposerAttachment) => void
  onRemove?: (attachmentId: string) => void
}

function resolveFileCategory(name: string, kind: string): { bg: string; icon: React.ReactNode } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) {
    return {
      bg: '#1a73e8',
      icon: <FileSpreadsheet className="composer-attachment-tile-icon" size={14} />,
    }
  }
  if (['pptx', 'ppt', 'key'].includes(ext)) {
    return {
      bg: '#9061f9',
      icon: <Presentation className="composer-attachment-tile-icon" size={14} />,
    }
  }
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'go', 'rs', 'c', 'cpp', 'html', 'css', 'sql', 'sh'].includes(ext)) {
    return {
      bg: '#00bba7',
      icon: <Box className="composer-attachment-tile-icon" size={14} />,
    }
  }
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext) || kind === 'audio') {
    return {
      bg: '#f59e0b',
      icon: <Music className="composer-attachment-tile-icon" size={14} />,
    }
  }
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext) || kind === 'video') {
    return {
      bg: '#ef4444',
      icon: <Video className="composer-attachment-tile-icon" size={14} />,
    }
  }
  return {
    bg: '#6b7280',
    icon: <FileText className="composer-attachment-tile-icon" size={14} />,
  }
}

export function ComposerAttachmentTray({
  attachments,
  onOpen,
  onRemove,
}: Props): React.ReactNode {
  if (attachments.length === 0) return null

  return (
    <div aria-label="已添加附件" className="composer-attachments composer-attachment-row">
      {attachments.map((attachment) => {
        const previewable = resolveDraftAttachmentPreviewContent(attachment) !== null
        const isImage = attachment.kind === 'image'
        const imgSrc =
          attachment.previewDataUrl ||
          (attachment.contentBase64
            ? `data:${attachment.mediaType};base64,${attachment.contentBase64}`
            : '')

        if (isImage && imgSrc) {
          return (
            <div
              className="composer-attachment-chip composer-attachment-chip--image"
              id={`chip-${attachment.id}`}
              key={attachment.id}
              onClick={previewable && onOpen ? () => onOpen(attachment) : undefined}
              onKeyDown={
                previewable && onOpen
                  ? (e) => {
                      if (e.key === 'Enter') onOpen(attachment)
                    }
                  : undefined
              }
              role={previewable && onOpen ? 'button' : undefined}
              tabIndex={previewable && onOpen ? 0 : undefined}
              title={attachment.error ?? attachment.name}
            >
              <img
                alt={attachment.name}
                className="composer-attachment-img"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
                src={imgSrc}
              />
              {attachment.status === 'error' && (
                <div
                  className="composer-attachment-error-badge"
                  title={attachment.error ?? '加载失败'}
                >
                  <AlertCircle size={14} />
                </div>
              )}
              {onRemove && (
                <button
                  aria-label={`移除附件 ${attachment.name}`}
                  className="composer-attachment-remove-btn composer-attachment-remove-btn--overlay"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(attachment.id)
                  }}
                  title="移除附件"
                  type="button"
                >
                  <X size={11} strokeWidth={2.6} />
                </button>
              )}
            </div>
          )
        }

        const category = resolveFileCategory(attachment.name, attachment.kind)
        return (
          <div
            className="composer-attachment-chip composer-attachment-chip--file"
            id={`chip-${attachment.id}`}
            key={attachment.id}
            onClick={previewable && onOpen ? () => onOpen(attachment) : undefined}
            onKeyDown={
              previewable && onOpen
                ? (e) => {
                    if (e.key === 'Enter') onOpen(attachment)
                  }
                : undefined
            }
            role={previewable && onOpen ? 'button' : undefined}
            tabIndex={previewable && onOpen ? 0 : undefined}
            title={attachment.error ?? attachment.name}
          >
            <div className="composer-attachment-tile-top">
              <div
                className="composer-attachment-badge"
                style={{ backgroundColor: category.bg, color: '#ffffff' }}
              >
                {category.icon}
              </div>
              {onRemove && (
                <button
                  aria-label={`移除附件 ${attachment.name}`}
                  className="composer-attachment-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(attachment.id)
                  }}
                  title="移除附件"
                  type="button"
                >
                  <X size={11} strokeWidth={2.6} />
                </button>
              )}
            </div>
            <span className="composer-attachment-name">{attachment.name}</span>
          </div>
        )
      })}
    </div>
  )
}
