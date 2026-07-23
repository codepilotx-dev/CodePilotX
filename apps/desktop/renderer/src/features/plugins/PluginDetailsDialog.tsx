import * as Dialog from '@radix-ui/react-dialog'
import type React from 'react'
import { useRef } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { PluginCatalogItem } from './pluginCatalog.js'
import { pluginPrimaryAction, pluginStatusLabel } from './pluginCatalog.js'
import { PluginIcon } from './PluginIcon.js'

type Props = {
  item: PluginCatalogItem | null
  open: boolean
  busy?: boolean
  error?: string | null
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onPrimaryAction: (item: PluginCatalogItem, trigger: HTMLButtonElement) => void
}

const CATEGORY_LABELS: Record<PluginCatalogItem['category'], string> = {
  included: '内置',
  manageable: '可管理',
  external: '外部',
}

export function PluginDetailsDialog({
  item,
  open,
  busy = false,
  error,
  restoreFocusElement,
  onOpenChange,
  onPrimaryAction,
}: Props): React.ReactNode {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  if (!item) return null

  const action = pluginPrimaryAction(item)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="permission-modal-backdrop plugin-details-dialog__backdrop">
          <Dialog.Content
            className="plugin-details-dialog"
            onCloseAutoFocus={event => {
              if (!restoreFocusElement?.isConnected) return
              event.preventDefault()
              restoreFocusElement.focus()
            }}
            onOpenAutoFocus={event => {
              event.preventDefault()
              closeButtonRef.current?.focus()
            }}
          >
            <header className="plugin-details-dialog__header">
              <span
                aria-hidden="true"
                className="plugin-details-dialog__plugin-icon"
                data-plugin-tone={item.tone}
              >
                <PluginIcon name={item.iconName} />
              </span>
              <div className="plugin-details-dialog__heading">
                <Dialog.Title className="plugin-details-dialog__title">
                  {item.name}
                </Dialog.Title>
                <Dialog.Description className="plugin-details-dialog__description">
                  {item.description}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton ref={closeButtonRef} title="关闭插件详情" variant="plain">
                  <X
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </IconButton>
              </Dialog.Close>
            </header>

            <ScrollArea className="plugin-details-dialog__scroll-area">
              <dl className="plugin-details-dialog__metadata">
                <div className="plugin-details-dialog__metadata-row">
                  <dt>来源</dt>
                  <dd>{CATEGORY_LABELS[item.category]}</dd>
                </div>
                <div className="plugin-details-dialog__metadata-row">
                  <dt>状态</dt>
                  <dd>{pluginStatusLabel(item)}</dd>
                </div>
              </dl>

              {error ? (
                <p className="plugin-details-dialog__error" role="status">
                  {error}
                </p>
              ) : null}
            </ScrollArea>

            <footer className="plugin-details-dialog__actions">
              <Dialog.Close asChild>
                <Button variant="secondary">关闭</Button>
              </Dialog.Close>
              {action ? (
                <Button
                  aria-pressed={action.pressed}
                  disabled={action.disabled}
                  loading={busy}
                  variant="primary"
                  onClick={event => onPrimaryAction(item, event.currentTarget)}
                >
                  {action.label}
                  {action.kind === 'open-external' ? (
                    <ExternalLink
                      aria-hidden="true"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  ) : null}
                </Button>
              ) : null}
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
