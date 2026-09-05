import * as Dialog from '@radix-ui/react-dialog'
import type React from 'react'
import { useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { PluginCatalogItem } from './pluginCatalog.js'
import { PluginIcon } from './PluginIcon.js'
import { useLastNonNull } from '../../hooks/usePresenceRetention.js'
import {
  PluginDetailsMetadata,
  PluginDetailsPrimaryAction,
} from './PluginDetailsContent.js'

type Props = {
  item: PluginCatalogItem | null
  open: boolean
  busy?: boolean
  error?: string | null
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onPrimaryAction: (
    item: PluginCatalogItem,
    trigger: HTMLButtonElement,
    checked?: boolean,
  ) => void
}

export function PluginDetailsDialog({
  item: currentItem,
  open,
  busy = false,
  error,
  restoreFocusElement,
  onOpenChange,
  onPrimaryAction,
}: Props): React.ReactNode {
  const retainedItem = useLastNonNull(currentItem)
  const item = open ? currentItem : retainedItem
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  if (!item) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop plugin-details-dialog__backdrop" />
        <Dialog.Content
            className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog plugin-details-dialog"
            data-dialog-size="detail"
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
            <header className="settings-management-dialog-header plugin-details-dialog__header">
              <span
                aria-hidden="true"
                className="plugin-details-dialog__plugin-icon"
                data-plugin-tone={item.tone}
              >
                <PluginIcon
                  logoDarkSource={item.logoDarkSource}
                  logoSource={item.logoSource}
                  name={item.iconName}
                />
              </span>
              <div className="settings-management-dialog-heading plugin-details-dialog__heading">
                <Dialog.Title className="plugin-details-dialog__title">
                  {item.name}
                </Dialog.Title>
                <Dialog.Description className="plugin-details-dialog__description">
                  {item.description}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton color="ghostSecondary" ref={closeButtonRef} size="toolbar" title="关闭插件详情">
                  <X
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </IconButton>
              </Dialog.Close>
            </header>

            <ScrollArea className="settings-management-dialog-body plugin-details-dialog__scroll-area">
              <PluginDetailsMetadata item={item} />

              {error ? (
                <p className="plugin-details-dialog__error" role="status">
                  {error}
                </p>
              ) : null}
            </ScrollArea>

            <footer className="settings-management-dialog-footer plugin-details-dialog__actions">
              <Dialog.Close asChild>
                <Button color="secondary">关闭</Button>
              </Dialog.Close>
              <PluginDetailsPrimaryAction
                busy={busy}
                item={item}
                onPrimaryAction={onPrimaryAction}
              />
            </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
