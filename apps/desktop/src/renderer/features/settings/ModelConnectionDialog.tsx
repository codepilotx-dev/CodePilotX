import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Search, X } from 'lucide-react'
import type {
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/types.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

type Props = {
  open: boolean
  dirty: boolean
  busy: boolean
  providerID: ModelProviderID
  providers: DesktopModelProviderSummary[]
  configuredProviderIDs: ReadonlySet<ModelProviderID>
  children: React.ReactNode
  returnFocusRef: React.RefObject<HTMLButtonElement | null>
  onOpen: () => void
  onClose: () => void
  onDiscard: () => void
  onProviderSelect: (provider: DesktopModelProviderSummary) => void
}

export function ModelConnectionDialog({
  open,
  dirty,
  busy,
  providerID,
  providers,
  configuredProviderIDs,
  children,
  returnFocusRef,
  onOpen,
  onClose,
  onDiscard,
  onProviderSelect,
}: Props): React.ReactNode {
  const [providerQuery, setProviderQuery] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const visibleProviders = useMemo(() => {
    const query = providerQuery.trim().toLowerCase()
    return providers
      .filter(provider => {
        if (!query) return true
        return [provider.displayName, provider.providerID, provider.npmPackage]
          .filter(Boolean)
          .some(value => value!.toLowerCase().includes(query))
      })
      .slice(0, 80)
  }, [providerQuery, providers])

  const configured = visibleProviders.filter(provider =>
    configuredProviderIDs.has(provider.providerID),
  )
  const unconfigured = visibleProviders.filter(
    provider => !configuredProviderIDs.has(provider.providerID),
  )

  function requestClose(): void {
    if (dirty) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={nextOpen => {
          if (nextOpen) onOpen()
          else requestClose()
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="settings-model-dialog-overlay" />
          <Dialog.Content
            className="settings-model-dialog"
            onEscapeKeyDown={event => {
              if (dirty) {
                event.preventDefault()
                setConfirmClose(true)
              }
            }}
            onInteractOutside={event => {
              if (dirty) {
                event.preventDefault()
                setConfirmClose(true)
              }
            }}
            onOpenAutoFocus={event => {
              event.preventDefault()
              searchRef.current?.focus()
            }}
            onCloseAutoFocus={event => {
              event.preventDefault()
              returnFocusRef.current?.focus()
            }}
          >
            <header className="settings-model-dialog-header">
              <div>
                <Dialog.Title className="settings-model-dialog-title">
                  配置模型连接
                </Dialog.Title>
                <Dialog.Description className="settings-model-dialog-description">
                  选择供应商、配置凭据并查看模型信息，验证新会话使用的连接。
                </Dialog.Description>
              </div>
              <button
                aria-label="关闭配置模型连接"
                className="settings-model-dialog-close"
                type="button"
                onClick={requestClose}
              >
                <X />
              </button>
            </header>

            <div className="settings-model-dialog-body">
              <aside className="settings-model-dialog-providers">
                <div className="settings-model-dialog-provider-search">
                  <Search />
                  <input
                    ref={searchRef}
                    aria-label="搜索模型供应商"
                    placeholder="名称、ID 或 npm 包名"
                    type="search"
                    value={providerQuery}
                    onChange={event => setProviderQuery(event.target.value)}
                  />
                </div>
                <div className="settings-model-dialog-provider-list">
                  <ProviderGroup
                    label="已配置"
                    providers={configured}
                    providerID={providerID}
                    disabled={busy}
                    onSelect={onProviderSelect}
                  />
                  <ProviderGroup
                    label="未配置"
                    providers={unconfigured}
                    providerID={providerID}
                    disabled={busy}
                    onSelect={onProviderSelect}
                  />
                  {visibleProviders.length === 0 ? (
                    <p className="settings-model-dialog-provider-empty">
                      未找到匹配的供应商。
                    </p>
                  ) : null}
                </div>
              </aside>
              <main className="settings-model-dialog-content">{children}</main>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmationDialog
        open={confirmClose}
        title="放弃未保存的连接更改？"
        description="供应商、Base URL 或模型的更改尚未保存。已单独保存的 API 密钥不会被撤销。"
        cancelLabel="继续编辑"
        actionLabel="放弃更改并关闭"
        tone="danger"
        onCancel={() => setConfirmClose(false)}
        onAction={() => {
          setConfirmClose(false)
          onDiscard()
        }}
      />
    </>
  )
}

function ProviderGroup({
  label,
  providers,
  providerID,
  disabled,
  onSelect,
}: {
  label: string
  providers: DesktopModelProviderSummary[]
  providerID: ModelProviderID
  disabled: boolean
  onSelect: (provider: DesktopModelProviderSummary) => void
}): React.ReactNode {
  if (providers.length === 0) return null
  return (
    <section className="settings-model-dialog-provider-group">
      <h3>{label}</h3>
      {providers.map(provider => (
        <button
          key={provider.providerID}
          aria-pressed={provider.providerID === providerID}
          className="settings-model-dialog-provider"
          data-selected={provider.providerID === providerID ? '' : undefined}
          disabled={disabled}
          type="button"
          onClick={() => onSelect(provider)}
        >
          <ProviderLogo
            displayName={provider.displayName}
            logoURL={provider.logoURL}
          />
          <span className="settings-model-dialog-provider-copy">
            <strong>{provider.displayName}</strong>
            <small>{providerDetail(provider)}</small>
          </span>
        </button>
      ))}
    </section>
  )
}

function ProviderLogo({
  displayName,
  logoURL,
}: {
  displayName: string
  logoURL: string | undefined
}): React.ReactNode {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [logoURL])

  if (!logoURL || failed) {
    return (
      <span className="settings-model-dialog-provider-fallback">
        {displayName.slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      src={logoURL}
      alt=""
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function providerDetail(provider: DesktopModelProviderSummary): string {
  if (provider.gatewaySource && provider.modelsDevSource) return 'Gateway + Models.dev'
  if (provider.gatewaySource) return 'Gateway'
  if (provider.modelsDevSource) return 'Models.dev'
  return '内置'
}
