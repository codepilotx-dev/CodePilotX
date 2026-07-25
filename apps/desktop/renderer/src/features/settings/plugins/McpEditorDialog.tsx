import * as Dialog from '@radix-ui/react-dialog'
import { Trash2, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type {
  DesktopEditableMcpScope,
  DesktopMcpServerListItem,
  SaveDesktopMcpServerOptions,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { Input } from '../../../components/ui/Input.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { SettingsDropdown } from '../SettingsDropdown.js'

type McpTransportTemplate = 'stdio' | 'http' | 'sse' | 'ws'

type FormState = {
  originalName: string
  name: string
  scope: DesktopEditableMcpScope
  type: McpTransportTemplate
  configText: string
}

type Props = {
  open: boolean
  server: DesktopMcpServerListItem | null
  busy: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onSave: (options: SaveDesktopMcpServerOptions) => Promise<void>
  onRemove: (server: DesktopMcpServerListItem) => void
  onError: (message: string) => void
}

const SCOPE_OPTIONS: Array<{ value: DesktopEditableMcpScope; label: string }> = [
  { value: 'user', label: '用户' },
  { value: 'local', label: '本地项目配置' },
]

const TYPE_OPTIONS: Array<{ value: McpTransportTemplate; label: string }> = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'http' },
  { value: 'sse', label: 'sse' },
  { value: 'ws', label: 'ws' },
]

export function McpEditorDialog({
  open,
  server,
  busy,
  restoreFocusElement,
  onOpenChange,
  onSave,
  onRemove,
  onError,
}: Props): React.ReactNode {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [form, setForm] = useState<FormState>(() => formForServer(null))
  const readonly = Boolean(server && !server.editable)

  useEffect(() => {
    if (open) setForm(formForServer(server))
  }, [open, server])

  function updateType(type: McpTransportTemplate): void {
    setForm(current => ({
      ...current,
      type,
      configText: formatConfig(templateConfig(type)),
    }))
  }

  async function save(): Promise<void> {
    const name = form.name.trim()
    if (!name) {
      onError('请输入 MCP server 名称。')
      return
    }
    let config: Record<string, unknown>
    try {
      const parsed = JSON.parse(form.configText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('配置必须是 JSON object。')
      }
      config = parsed as Record<string, unknown>
    } catch (error) {
      onError(`JSON 无法解析：${errorMessageOf(error)}`)
      return
    }

    await onSave({
      originalName: form.originalName || undefined,
      name,
      scope: form.scope,
      config,
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="permission-modal-backdrop">
          <Dialog.Content
            className="permission-modal tw:flex tw:max-h-[min(44rem,calc(100vh-3rem))] tw:w-[min(42rem,calc(100vw-3rem))] tw:flex-col tw:overflow-hidden tw:rounded-xl tw:p-0 tw:text-app-text"
            onCloseAutoFocus={event => {
              if (!restoreFocusElement?.isConnected) return
              event.preventDefault()
              restoreFocusElement.focus()
            }}
            onOpenAutoFocus={event => {
              event.preventDefault()
              closeRef.current?.focus()
            }}
          >
            <header className="tw:flex tw:items-start tw:gap-3 tw:border-b tw:border-app-border tw:px-5 tw:py-4">
              <span className="tw:min-w-0 tw:flex-1">
                <Dialog.Title className="tw:m-0 tw:text-lg tw:font-[var(--font-weight-heading)]">
                  {server ? `MCP：${server.name}` : '新增 MCP server'}
                </Dialog.Title>
                <Dialog.Description className="tw:mt-1 tw:mb-0 tw:text-sm tw:text-app-text-soft">
                  {readonly
                    ? '该 MCP server 来自只读 scope，只能查看。'
                    : '选择模板快速开始，也可以直接编辑高级 JSON。'}
                </Dialog.Description>
              </span>
              <Dialog.Close asChild>
                <IconButton ref={closeRef} title="关闭 MCP 编辑器" variant="plain">
                  <X
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </IconButton>
              </Dialog.Close>
            </header>

            <div className="tw:grid tw:min-h-0 tw:flex-1 tw:gap-4 tw:overflow-auto tw:px-5 tw:py-4">
              <label className="tw:grid tw:gap-1.5">
                <span className="tw:text-sm tw:font-[var(--font-weight-label)]">名称</span>
                <Input
                  disabled={readonly}
                  value={form.name}
                  placeholder="server-name"
                  onChange={event =>
                    setForm(current => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <div className="tw:grid tw:grid-cols-2 tw:gap-4 tw:max-[640px]:grid-cols-1">
                <label className="tw:grid tw:gap-1.5">
                  <span className="tw:text-sm tw:font-[var(--font-weight-label)]">Scope</span>
                  {readonly ? (
                    <span className="tw:flex tw:min-h-9 tw:items-center tw:rounded-md tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:text-sm tw:text-app-text-soft">
                      {server?.scope}
                    </span>
                  ) : (
                    <SettingsDropdown
                      value={form.scope}
                      width={240}
                      options={SCOPE_OPTIONS}
                      onChange={value =>
                        setForm(current => ({
                          ...current,
                          scope: value as DesktopEditableMcpScope,
                        }))
                      }
                      ariaLabel="MCP scope"
                    />
                  )}
                </label>
                <label className="tw:grid tw:gap-1.5">
                  <span className="tw:text-sm tw:font-[var(--font-weight-label)]">Transport</span>
                  {readonly ? (
                    <span className="tw:flex tw:min-h-9 tw:items-center tw:rounded-md tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:text-sm tw:text-app-text-soft">
                      {server?.type}
                    </span>
                  ) : (
                    <SettingsDropdown
                      disabled={Boolean(server)}
                      value={form.type}
                      width={240}
                      options={TYPE_OPTIONS}
                      onChange={value => updateType(value as McpTransportTemplate)}
                      ariaLabel="MCP transport"
                    />
                  )}
                </label>
              </div>
              <label className="tw:grid tw:gap-1.5">
                <span className="tw:text-sm tw:font-[var(--font-weight-label)]">
                  高级 JSON
                </span>
                <textarea
                  className="settings-textarea settings-code-textarea tw:min-h-52 tw:w-full tw:resize-y"
                  disabled={readonly}
                  rows={10}
                  spellCheck={false}
                  value={form.configText}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      configText: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <footer className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-app-border tw:px-5 tw:py-4">
              <span>
                {server?.removable ? (
                  <Button
                    disabled={busy}
                    tone="danger"
                    onClick={() => onRemove(server)}
                  >
                    <Trash2
                      aria-hidden="true"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                    删除
                  </Button>
                ) : null}
              </span>
              <span className="tw:flex tw:items-center tw:gap-2">
                <Dialog.Close asChild>
                  <Button>关闭</Button>
                </Dialog.Close>
                {!readonly ? (
                  <Button
                    disabled={busy}
                    loading={busy}
                    variant="primary"
                    onClick={() => void save()}
                  >
                    保存
                  </Button>
                ) : null}
              </span>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formForServer(server: DesktopMcpServerListItem | null): FormState {
  if (!server) {
    return {
      originalName: '',
      name: '',
      scope: 'user',
      type: 'stdio',
      configText: formatConfig(templateConfig('stdio')),
    }
  }
  return {
    originalName: server.name,
    name: server.name,
    scope: server.scope === 'local' ? 'local' : 'user',
    type: editableTransport(server.type),
    configText: formatConfig(server.config),
  }
}

function templateConfig(type: McpTransportTemplate): Record<string, unknown> {
  switch (type) {
    case 'http':
      return { type: 'http', url: 'https://example.com/mcp' }
    case 'sse':
      return { type: 'sse', url: 'https://example.com/sse' }
    case 'ws':
      return { type: 'ws', url: 'wss://example.com/mcp' }
    case 'stdio':
      return { type: 'stdio', command: 'node', args: ['server.js'] }
  }
}

function editableTransport(value: string): McpTransportTemplate {
  return value === 'http' || value === 'sse' || value === 'ws'
    ? value
    : 'stdio'
}

function formatConfig(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2)
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return '未知错误'
}
