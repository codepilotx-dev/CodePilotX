import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, ChevronUp, Trash2, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type {
  DesktopEditableMcpScope,
  DesktopMcpServerConfig,
  DesktopMcpServerListItem,
  SaveDesktopMcpServerOptions,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { Input } from '../../../components/ui/Input.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { SettingsDropdown } from '../SettingsDropdown.js'

type TransportType = DesktopMcpServerConfig['type']

type FormState = {
  originalName: string
  name: string
  scope: DesktopEditableMcpScope
  enabled: boolean
  diagnosticContext: boolean
  type: TransportType
  command: string
  argsText: string
  cwd: string
  envText: string
  envFromHostText: string
  url: string
  headersText: string
  headerFromEnvText: string
  bearerTokenEnvVar: string
  startupTimeoutMs: string
  toolTimeoutMs: string
  configText: string
}

export type ParsedMcpServerJson = {
  name: string
  scope: DesktopEditableMcpScope
  enabled: boolean
  diagnosticContext: boolean
  transport: DesktopMcpServerConfig
  startupTimeoutMs?: number
  toolTimeoutMs?: number
}

type Props = {
  open: boolean
  server: DesktopMcpServerListItem | null
  busy: boolean
  workspaceAvailable: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onSave: (options: SaveDesktopMcpServerOptions) => Promise<void>
  onRemove: (server: DesktopMcpServerListItem) => void
  onError: (message: string) => void
}

const SCOPE_OPTIONS: Array<{ value: DesktopEditableMcpScope; label: string }> = [
  { value: 'user', label: '用户' },
  { value: 'local', label: '当前工作区' },
]

const TYPE_OPTIONS: Array<{ value: TransportType; label: string }> = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'Streamable HTTP' },
]
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SENSITIVE_NAME = /(?:^|[_-])(authorization|cookie|password|secret|token|api[_-]?key)(?:$|[_-])/i
const STATIC_SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
])

export function McpEditorDialog({
  open,
  server,
  busy,
  workspaceAvailable,
  restoreFocusElement,
  onOpenChange,
  onSave,
  onRemove,
}: Props): React.ReactNode {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [form, setForm] = useState<FormState>(() => formForServer(null))
  const [advanced, setAdvanced] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(formForServer(server))
    setAdvanced(false)
    setValidationError(null)
  }, [open, server])

  function update(mutator: (current: FormState) => FormState): void {
    setValidationError(null)
    setForm(current => {
      const next = mutator(current)
      try {
        return { ...next, configText: formatConfig(editorConfigForForm(next)) }
      } catch {
        return next
      }
    })
  }

  function updateType(type: TransportType): void {
    const transport = templateConfig(type)
    setValidationError(null)
    setForm(current => {
      const next: FormState = {
        ...formFromTransport(transport),
        originalName: current.originalName,
        name: current.name,
        scope: current.scope,
        enabled: current.enabled,
        diagnosticContext: type === 'stdio'
          ? current.diagnosticContext
          : false,
        startupTimeoutMs: current.startupTimeoutMs,
        toolTimeoutMs: current.toolTimeoutMs,
        configText: '',
      }
      return {
        ...next,
        configText: formatConfig(editorConfigForForm(next)),
      }
    })
  }

  function applyAdvancedJson(): void {
    try {
      const config = parseMcpServerJson(form.configText)
      setForm(current => formFromEditorConfig(config, current.originalName))
      setValidationError(null)
    } catch (error) {
      setValidationError(`高级 JSON 无法应用：${errorMessageOf(error)}`)
    }
  }

  async function save(): Promise<void> {
    let candidate = form
    if (advanced) {
      try {
        candidate = formFromEditorConfig(
          parseMcpServerJson(form.configText),
          form.originalName,
        )
      } catch (error) {
        setValidationError(`高级 JSON 无法应用：${errorMessageOf(error)}`)
        return
      }
    }
    const name = candidate.name.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
      setValidationError('名称必须为 1-64 位字母、数字、点、下划线或连字符。')
      return
    }
    if (candidate.scope === 'local' && !workspaceAvailable) {
      setValidationError('工作区 MCP 配置需要先打开一个工作区。')
      return
    }
    let transport: DesktopMcpServerConfig
    try {
      transport = validateTransport(transportForForm(candidate))
    } catch (error) {
      setValidationError(errorMessageOf(error))
      return
    }
    if (candidate.diagnosticContext && transport.type !== 'stdio') {
      setValidationError('会话诊断上下文只支持 stdio transport。')
      return
    }
    const startupTimeoutMs = optionalTimeout(candidate.startupTimeoutMs, '启动超时')
    const toolTimeoutMs = optionalTimeout(candidate.toolTimeoutMs, '工具超时')
    if (startupTimeoutMs instanceof Error) {
      setValidationError(startupTimeoutMs.message)
      return
    }
    if (toolTimeoutMs instanceof Error) {
      setValidationError(toolTimeoutMs.message)
      return
    }
    setValidationError(null)
    await onSave({
      originalName: candidate.originalName || undefined,
      name,
      scope: candidate.scope,
      enabled: candidate.enabled,
      diagnosticContext: candidate.diagnosticContext,
      transport,
      ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
      ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
    })
  }

  const runtimeError = server?.runtime?.error?.message
  const needsAuth = server?.runtime?.state === 'needs_auth'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="permission-modal-backdrop">
          <Dialog.Content
            className="permission-modal tw:flex tw:max-h-[min(48rem,calc(100vh-3rem))] tw:w-[min(44rem,calc(100vw-3rem))] tw:flex-col tw:overflow-hidden tw:rounded-xl tw:p-0 tw:text-app-text"
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
                  使用结构化字段配置 stdio 或 Streamable HTTP；HTTP 会在协议不兼容时自动回退 SSE。
                </Dialog.Description>
              </span>
              <Dialog.Close asChild>
                <IconButton ref={closeRef} title="关闭 MCP 编辑器" variant="plain">
                  <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </IconButton>
              </Dialog.Close>
            </header>

            <div className="tw:grid tw:min-h-0 tw:flex-1 tw:gap-4 tw:overflow-auto tw:px-5 tw:py-4">
              {runtimeError || needsAuth ? (
                <div className="tw:rounded-lg tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-sm tw:text-app-text-soft">
                  {runtimeError ?? '该 server 需要认证。当前版本不提供 OAuth 登录，请使用宿主环境变量配置凭据。'}
                </div>
              ) : null}
              {validationError ? (
                <div
                  className="tw:rounded-lg tw:border tw:border-app-danger/40 tw:bg-app-danger/10 tw:px-3 tw:py-2 tw:text-sm tw:text-app-danger"
                  role="alert"
                >
                  {validationError}
                </div>
              ) : null}

              <div className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-end tw:gap-4 tw:max-[640px]:grid-cols-1">
                <Field label="名称">
                  <Input
                    value={form.name}
                    placeholder="server-name"
                    onChange={event => update(current => ({ ...current, name: event.target.value }))}
                  />
                </Field>
                <span className="tw:flex tw:min-h-9 tw:items-center tw:gap-2">
                  <ToggleSwitch
                    ariaLabel={`${form.enabled ? '禁用' : '启用'} MCP server`}
                    checked={form.enabled}
                    onChange={enabled => update(current => ({ ...current, enabled }))}
                  />
                  <span className="tw:text-sm">{form.enabled ? '启用' : '禁用'}</span>
                </span>
              </div>

              <div className="tw:grid tw:grid-cols-2 tw:gap-4 tw:max-[640px]:grid-cols-1">
                <Field label="Scope">
                  <SettingsDropdown
                    value={form.scope}
                    width={260}
                    options={SCOPE_OPTIONS.map(option => ({
                      ...option,
                      disabled: option.value === 'local' && !workspaceAvailable,
                    }))}
                    onChange={value => update(current => ({
                      ...current,
                      scope: value as DesktopEditableMcpScope,
                    }))}
                    ariaLabel="MCP scope"
                  />
                </Field>
                <Field label="Transport">
                  <SettingsDropdown
                    value={form.type}
                    width={260}
                    options={TYPE_OPTIONS}
                    onChange={value => updateType(value as TransportType)}
                    ariaLabel="MCP transport"
                  />
                </Field>
              </div>

              {form.type === 'stdio' ? (
                <>
                  <div className="tw:grid tw:gap-2 tw:rounded-lg tw:border tw:border-app-border tw:bg-app-canvas tw:p-3">
                    <span className="tw:flex tw:min-h-9 tw:items-center tw:justify-between tw:gap-3">
                      <span className="tw:text-sm tw:font-[var(--font-weight-label)]">
                        传递会话诊断上下文
                      </span>
                      <ToggleSwitch
                        ariaLabel={`${form.diagnosticContext ? '关闭' : '开启'}会话诊断上下文`}
                        checked={form.diagnosticContext}
                        onChange={diagnosticContext => update(current => ({
                          ...current,
                          diagnosticContext,
                        }))}
                      />
                    </span>
                    <span className="tw:text-xs tw:leading-5 tw:text-app-text-soft">
                      开启后，CodePilotX 会向此本地进程传递当前会话最近的可见消息和工具状态摘要。不会传递系统提示词、推理内容、工作区路径或工具原始参数。
                    </span>
                  </div>
                  <Field label="命令">
                    <Input
                      value={form.command}
                      placeholder="bun"
                      onChange={event => update(current => ({ ...current, command: event.target.value }))}
                    />
                  </Field>
                  <Field label="参数（每行一个）">
                    <textarea
                      className="settings-textarea settings-code-textarea tw:min-h-24 tw:w-full tw:resize-y"
                      rows={4}
                      spellCheck={false}
                      value={form.argsText}
                      onChange={event => update(current => ({ ...current, argsText: event.target.value }))}
                    />
                  </Field>
                  <Field label="工作目录（可选，必须为绝对路径）">
                    <Input
                      value={form.cwd}
                      placeholder="C:\workspace"
                      onChange={event => update(current => ({ ...current, cwd: event.target.value }))}
                    />
                  </Field>
                  <JsonMapField
                    label="静态环境变量（不允许凭据）"
                    value={form.envText}
                    onChange={value => update(current => ({ ...current, envText: value }))}
                  />
                  <JsonMapField
                    label="宿主环境变量映射（目标变量 → 宿主变量名）"
                    value={form.envFromHostText}
                    onChange={value => update(current => ({ ...current, envFromHostText: value }))}
                  />
                </>
              ) : (
                <>
                  <div className="tw:rounded-lg tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-xs tw:leading-5 tw:text-app-text-soft">
                    为避免向远程服务暴露会话内容，Streamable HTTP 不支持会话诊断上下文。
                  </div>
                  <Field label="MCP URL">
                    <Input
                      value={form.url}
                      placeholder="https://example.com/mcp"
                      onChange={event => update(current => ({ ...current, url: event.target.value }))}
                    />
                  </Field>
                  <JsonMapField
                    label="静态 Header（不允许 Authorization/Cookie）"
                    value={form.headersText}
                    onChange={value => update(current => ({ ...current, headersText: value }))}
                  />
                  <JsonMapField
                    label="Header 环境变量映射（Header → 宿主变量名）"
                    value={form.headerFromEnvText}
                    onChange={value => update(current => ({ ...current, headerFromEnvText: value }))}
                  />
                  <Field label="Bearer Token 环境变量名（可选）">
                    <Input
                      value={form.bearerTokenEnvVar}
                      placeholder="MCP_ACCESS_TOKEN"
                      onChange={event => update(current => ({ ...current, bearerTokenEnvVar: event.target.value }))}
                    />
                  </Field>
                </>
              )}

              <div className="tw:grid tw:grid-cols-2 tw:gap-4 tw:max-[640px]:grid-cols-1">
                <Field label="启动超时（ms）">
                  <Input
                    inputMode="numeric"
                    value={form.startupTimeoutMs}
                    placeholder="10000"
                    onChange={event => update(current => ({ ...current, startupTimeoutMs: event.target.value }))}
                  />
                </Field>
                <Field label="工具超时（ms）">
                  <Input
                    inputMode="numeric"
                    value={form.toolTimeoutMs}
                    placeholder="60000"
                    onChange={event => update(current => ({ ...current, toolTimeoutMs: event.target.value }))}
                  />
                </Field>
              </div>

              <Button
                aria-expanded={advanced}
                onClick={() => setAdvanced(current => !current)}
              >
                {advanced ? <ChevronUp aria-hidden="true" size={APP_ICON_SIZE} /> : <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} />}
                高级 JSON
              </Button>
              {advanced ? (
                <Field label="Server JSON">
                  <textarea
                    className="settings-textarea settings-code-textarea tw:min-h-52 tw:w-full tw:resize-y"
                    rows={10}
                    spellCheck={false}
                    value={form.configText}
                    onBlur={applyAdvancedJson}
                    onChange={event => {
                      setValidationError(null)
                      setForm(current => ({
                        ...current,
                        configText: event.target.value,
                      }))
                    }}
                  />
                </Field>
              ) : null}
            </div>

            <footer className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-app-border tw:px-5 tw:py-4">
              <span>
                {server?.removable ? (
                  <Button disabled={busy} tone="danger" onClick={() => onRemove(server)}>
                    <Trash2 aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    删除
                  </Button>
                ) : null}
              </span>
              <span className="tw:flex tw:items-center tw:gap-2">
                <Dialog.Close asChild><Button>关闭</Button></Dialog.Close>
                <Button disabled={busy} loading={busy} variant="primary" onClick={() => void save()}>
                  保存
                </Button>
              </span>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <label className="tw:grid tw:gap-1.5">
      <span className="tw:text-sm tw:font-[var(--font-weight-label)]">{label}</span>
      {children}
    </label>
  )
}

function JsonMapField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.ReactNode {
  return (
    <Field label={label}>
      <textarea
        className="settings-textarea settings-code-textarea tw:min-h-24 tw:w-full tw:resize-y"
        rows={4}
        spellCheck={false}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </Field>
  )
}

function formForServer(server: DesktopMcpServerListItem | null): FormState {
  if (!server) {
    const transport = templateConfig('stdio')
    const form: FormState = {
      ...formFromTransport(transport),
      originalName: '',
      name: '',
      scope: 'user',
      enabled: true,
      diagnosticContext: false,
      startupTimeoutMs: '',
      toolTimeoutMs: '',
      configText: '',
    }
    return {
      ...form,
      configText: formatConfig(editorConfigForForm(form)),
    }
  }
  const form: FormState = {
    ...formFromTransport(server.transport),
    originalName: server.name,
    name: server.name,
    scope: server.scope,
    enabled: server.enabled,
    diagnosticContext: server.diagnosticContext,
    startupTimeoutMs: server.startupTimeoutMs?.toString() ?? '',
    toolTimeoutMs: server.toolTimeoutMs?.toString() ?? '',
    configText: '',
  }
  return {
    ...form,
    configText: formatConfig(editorConfigForForm(form)),
  }
}

function formFromTransport(transport: DesktopMcpServerConfig): Omit<
  FormState,
  | 'originalName'
  | 'name'
  | 'scope'
  | 'enabled'
  | 'diagnosticContext'
  | 'startupTimeoutMs'
  | 'toolTimeoutMs'
> {
  return {
    type: transport.type,
    command: transport.type === 'stdio' ? transport.command : '',
    argsText: transport.type === 'stdio' ? (transport.args ?? []).join('\n') : '',
    cwd: transport.type === 'stdio' ? transport.cwd ?? '' : '',
    envText: formatMap(transport.type === 'stdio' ? transport.env : undefined),
    envFromHostText: formatMap(transport.type === 'stdio' ? transport.envFromHost : undefined),
    url: transport.type === 'http' ? transport.url : '',
    headersText: formatMap(transport.type === 'http' ? transport.headers : undefined),
    headerFromEnvText: formatMap(transport.type === 'http' ? transport.headerFromEnv : undefined),
    bearerTokenEnvVar: transport.type === 'http' ? transport.bearerTokenEnvVar ?? '' : '',
    configText: formatConfig(transport),
  }
}

function formFromEditorConfig(
  config: ParsedMcpServerJson,
  originalName: string,
): FormState {
  const form: FormState = {
    ...formFromTransport(config.transport),
    originalName,
    name: config.name,
    scope: config.scope,
    enabled: config.enabled,
    diagnosticContext: config.diagnosticContext,
    startupTimeoutMs: config.startupTimeoutMs?.toString() ?? '',
    toolTimeoutMs: config.toolTimeoutMs?.toString() ?? '',
    configText: '',
  }
  return {
    ...form,
    configText: formatConfig(editorConfigForForm(form)),
  }
}

function editorConfigForForm(form: FormState): ParsedMcpServerJson {
  const transport = transportForForm(form)
  if (form.diagnosticContext && transport.type !== 'stdio') {
    throw new Error('会话诊断上下文只支持 stdio transport。')
  }
  const startupTimeoutMs = optionalTimeout(form.startupTimeoutMs, '启动超时')
  const toolTimeoutMs = optionalTimeout(form.toolTimeoutMs, '工具超时')
  if (startupTimeoutMs instanceof Error) throw startupTimeoutMs
  if (toolTimeoutMs instanceof Error) throw toolTimeoutMs
  return {
    name: form.name,
    scope: form.scope,
    enabled: form.enabled,
    diagnosticContext: form.diagnosticContext,
    transport,
    ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
    ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
  }
}

function transportForForm(form: FormState): DesktopMcpServerConfig {
  if (form.type === 'stdio') {
    const command = form.command.trim()
    if (!command) throw new Error('请输入 stdio 命令。')
    const args = form.argsText.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    const env = parseStringMap(form.envText, '静态环境变量')
    const envFromHost = parseStringMap(form.envFromHostText, '宿主环境变量映射')
    return {
      type: 'stdio',
      command,
      ...(args.length ? { args } : {}),
      ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(Object.keys(envFromHost).length ? { envFromHost } : {}),
    }
  }
  const url = form.url.trim()
  if (!url) throw new Error('请输入 MCP URL。')
  const headers = parseStringMap(form.headersText, '静态 Header')
  const headerFromEnv = parseStringMap(form.headerFromEnvText, 'Header 环境变量映射')
  return {
    type: 'http',
    url,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(Object.keys(headerFromEnv).length ? { headerFromEnv } : {}),
    ...(form.bearerTokenEnvVar.trim()
      ? { bearerTokenEnvVar: form.bearerTokenEnvVar.trim() }
      : {}),
  }
}

export function parseMcpTransportJson(text: string): DesktopMcpServerConfig {
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('高级 JSON 必须是 object。')
  }
  return validateTransport(parsed as Record<string, unknown>)
}

export function parseMcpServerJson(text: string): ParsedMcpServerJson {
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('高级 JSON 必须是 object。')
  }
  const value = parsed as Record<string, unknown>
  rejectUnknownFields(value, [
    'name',
    'scope',
    'enabled',
    'diagnosticContext',
    'transport',
    'startupTimeoutMs',
    'toolTimeoutMs',
  ])
  if (
    typeof value.name !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.name.trim())
  ) {
    throw new Error('名称必须为 1-64 位字母、数字、点、下划线或连字符。')
  }
  if (value.scope !== 'user' && value.scope !== 'local') {
    throw new Error('scope 只支持 user 或 local。')
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error('enabled 必须是 boolean。')
  }
  if (
    value.diagnosticContext !== undefined
    && typeof value.diagnosticContext !== 'boolean'
  ) {
    throw new Error('diagnosticContext 必须是 boolean。')
  }
  if (
    !value.transport
    || typeof value.transport !== 'object'
    || Array.isArray(value.transport)
  ) {
    throw new Error('transport 必须是 object。')
  }
  const transport = validateTransport(value.transport as Record<string, unknown>)
  const diagnosticContext = value.diagnosticContext === true
  if (diagnosticContext && transport.type !== 'stdio') {
    throw new Error('会话诊断上下文只支持 stdio transport。')
  }
  const startupTimeoutMs = validateJsonTimeout(
    value.startupTimeoutMs,
    '启动超时',
  )
  const toolTimeoutMs = validateJsonTimeout(value.toolTimeoutMs, '工具超时')
  return {
    name: value.name.trim(),
    scope: value.scope,
    enabled: value.enabled,
    diagnosticContext,
    transport,
    ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
    ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
  }
}

function validateTransport(value: Record<string, unknown> | DesktopMcpServerConfig): DesktopMcpServerConfig {
  if (value.type === 'stdio') {
    rejectUnknownFields(value, ['type', 'command', 'args', 'cwd', 'env', 'envFromHost'])
    if (typeof value.command !== 'string' || !value.command.trim()) {
      throw new Error('stdio command 必须是非空字符串。')
    }
    const args = value.args
    if (args !== undefined && (
      !Array.isArray(args)
      || args.some(argument => typeof argument !== 'string')
    )) throw new Error('stdio args 必须是字符串数组。')
    const cwd = value.cwd
    if (cwd !== undefined && typeof cwd !== 'string') {
      throw new Error('stdio cwd 必须是字符串。')
    }
    if (
      typeof cwd === 'string'
      && cwd
      && !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(cwd)
    ) throw new Error('stdio cwd 必须是绝对路径。')
    const env = validateStringMap(value.env, '静态环境变量')
    for (const name of Object.keys(env ?? {})) {
      if (!ENV_NAME.test(name)) throw new Error(`${name} 不是有效的环境变量名。`)
      if (SENSITIVE_NAME.test(name)) {
        throw new Error(`${name} 看起来包含凭据，请改用宿主环境变量映射。`)
      }
    }
    const envFromHost = validateStringMap(value.envFromHost, '宿主环境变量映射')
    for (const source of Object.values(envFromHost ?? {})) {
      if (!ENV_NAME.test(source)) throw new Error(`${source} 不是有效的宿主环境变量名。`)
    }
    return {
      type: 'stdio',
      command: value.command.trim(),
      ...(Array.isArray(args) && args.length ? { args: [...args] as string[] } : {}),
      ...(typeof cwd === 'string' && cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(env && Object.keys(env).length ? { env } : {}),
      ...(envFromHost && Object.keys(envFromHost).length ? { envFromHost } : {}),
    }
  }
  if (value.type === 'http') {
    rejectUnknownFields(value, [
      'type',
      'url',
      'headers',
      'headerFromEnv',
      'bearerTokenEnvVar',
    ])
    if (typeof value.url !== 'string' || !value.url.trim()) {
      throw new Error('HTTP url 必须是非空字符串。')
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(value.url)
    } catch {
      throw new Error('HTTP url 无效。')
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('HTTP url 只支持 http 或 https。')
    }
    const headers = validateStringMap(value.headers, '静态 Header')
    for (const name of Object.keys(headers ?? {})) {
      if (STATIC_SECRET_HEADERS.has(name.toLowerCase())) {
        throw new Error(`${name} 必须通过环境变量引用。`)
      }
    }
    const headerFromEnv = validateStringMap(value.headerFromEnv, 'Header 环境变量映射')
    for (const source of Object.values(headerFromEnv ?? {})) {
      if (!ENV_NAME.test(source)) throw new Error(`${source} 不是有效的宿主环境变量名。`)
    }
    const bearerTokenEnvVar = value.bearerTokenEnvVar
    if (
      bearerTokenEnvVar !== undefined
      && (typeof bearerTokenEnvVar !== 'string'
        || !ENV_NAME.test(bearerTokenEnvVar))
    ) throw new Error('Bearer token 环境变量名无效。')
    return {
      type: 'http',
      url: value.url.trim(),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
      ...(headerFromEnv && Object.keys(headerFromEnv).length
        ? { headerFromEnv }
        : {}),
      ...(typeof bearerTokenEnvVar === 'string' && bearerTokenEnvVar
        ? { bearerTokenEnvVar }
        : {}),
    }
  }
  throw new Error('高级 JSON 只支持 stdio 或 http transport。')
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown) throw new Error(`未知字段：${unknown}`)
}

function validateStringMap(
  value: unknown,
  label: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是字符串 map。`)
  }
  if (Object.entries(value).some(
    ([key, item]) => !key.trim() || typeof item !== 'string',
  )) throw new Error(`${label} 的键和值都必须是字符串。`)
  return { ...value } as Record<string, string>
}

function templateConfig(type: TransportType): DesktopMcpServerConfig {
  return type === 'http'
    ? { type: 'http', url: 'https://example.com/mcp' }
    : { type: 'stdio', command: 'bun', args: ['server.ts'] }
}

function parseStringMap(text: string, label: string): Record<string, string> {
  if (!text.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} JSON 无法解析：${errorMessageOf(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON object。`)
  }
  const entries = Object.entries(parsed)
  if (entries.some(([key, value]) => !key.trim() || typeof value !== 'string')) {
    throw new Error(`${label} 的键和值都必须是字符串。`)
  }
  return Object.fromEntries(entries) as Record<string, string>
}

function optionalTimeout(value: string, label: string): number | undefined | Error {
  if (!value.trim()) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 100 || number > 600_000) {
    return new Error(`${label}必须是 100-600000ms 之间的整数。`)
  }
  return number
}

function validateJsonTimeout(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 100 || Number(value) > 600_000) {
    throw new Error(`${label}必须是 100-600000ms 之间的整数。`)
  }
  return Number(value)
}

function formatMap(value?: Record<string, string>): string {
  return JSON.stringify(value ?? {}, null, 2)
}

function formatConfig(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}
