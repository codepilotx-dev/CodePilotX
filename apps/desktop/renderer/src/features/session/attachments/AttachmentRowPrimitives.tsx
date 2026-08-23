import { FileText, Image, ImageOff, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'

type AttachmentHorizontalRowProps = {
  ariaLabel: string
  children: ReactNode
  reverse?: boolean
}

export function AttachmentHorizontalRow({
  ariaLabel,
  children,
  reverse = false,
}: AttachmentHorizontalRowProps): React.ReactNode {
  return (
    <div
      aria-label={ariaLabel}
      className="attachment-horizontal-row"
      data-reverse={reverse || undefined}
      role="group"
    >
      <div className="attachment-horizontal-row__content">{children}</div>
    </div>
  )
}

type AttachmentImageTileProps = {
  errorMessage?: string
  name: string
  onOpen?: () => void
  onRemove?: () => void
  source?: string
  status: 'loading' | 'ready' | 'error'
}

export function AttachmentImageTile({
  errorMessage,
  name,
  onOpen,
  onRemove,
  source,
  status,
}: AttachmentImageTileProps): React.ReactNode {
  const content = status === 'loading' ? (
    <span aria-label={`${name} 正在加载`} className="attachment-image-tile__loading" />
  ) : status === 'error' ? (
    <span className="attachment-image-tile__error">
      <ImageOff aria-hidden="true" size={APP_ICON_SIZE} />
      <span>加载失败</span>
    </span>
  ) : source ? (
    <img alt={name} className="attachment-image-tile__image" src={source} />
  ) : (
    <span className="attachment-image-tile__fallback">
      <Image aria-hidden="true" size={APP_ICON_SIZE} />
    </span>
  )

  return (
    <div
      className="attachment-image-tile"
      data-status={status}
      title={errorMessage ?? name}
    >
      {onOpen ? (
        <button
          aria-label={`打开 ${name}`}
          className="attachment-image-tile__open"
          onClick={onOpen}
          type="button"
        >
          {content}
        </button>
      ) : (
        <span className="attachment-image-tile__open">{content}</span>
      )}
      {onRemove ? <AttachmentRemoveButton name={name} onRemove={onRemove} /> : null}
    </div>
  )
}

type AttachmentFilePillProps = {
  detail?: string
  error?: boolean
  name: string
  onOpen?: () => void
  onRemove?: () => void
}

export function AttachmentFilePill({
  detail,
  error = false,
  name,
  onOpen,
  onRemove,
}: AttachmentFilePillProps): React.ReactNode {
  const content = (
    <>
      <FileText aria-hidden="true" className="attachment-file-pill__icon" size={APP_ICON_SIZE} />
      <span className="attachment-file-pill__text">
        <span className="attachment-file-pill__name">{name}</span>
        {detail ? <span className="attachment-file-pill__detail">{detail}</span> : null}
      </span>
    </>
  )

  return (
    <div
      className="attachment-file-pill"
      data-removable={onRemove ? 'true' : undefined}
      data-status={error ? 'error' : 'ready'}
      title={detail ? `${name} · ${detail}` : name}
    >
      {onOpen ? (
        <Button color="primary"
          aria-label={`打开 ${name}`}
          className="attachment-file-pill__open"
          onClick={onOpen}
        >
          {content}
        </Button>
      ) : (
        <span className="attachment-file-pill__open">{content}</span>
      )}
      {onRemove ? <AttachmentRemoveButton name={name} onRemove={onRemove} /> : null}
    </div>
  )
}

function AttachmentRemoveButton({
  name,
  onRemove,
}: {
  name: string
  onRemove: () => void
}): React.ReactNode {
  return (
    <IconButton
      className="attachment-item-remove"
      color="ghostSecondary"
      onClick={event => {
        event.stopPropagation()
        onRemove()
      }}
      size="iconMd"
      title={`移除 ${name}`}
    >
      <X aria-hidden="true" size={12} strokeWidth={2.25} />
    </IconButton>
  )
}
