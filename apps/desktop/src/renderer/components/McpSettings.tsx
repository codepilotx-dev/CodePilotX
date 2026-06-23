import { desktopClient } from '../services/desktopClient.js'
import React, { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { APP_ICON_SIZE } from './ui/iconTokens.js'
import type {
  DesktopEditableMcpScope,
  DesktopMcpServerListItem,
} from '../../shared/types.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { ToggleSwitch } from './ToggleSwitch.js'

type McpTransportTemplate = 'stdio' | 'http' | 'sse' | 'ws'

const SCOPE_OPTIONS: Array<{ value: DesktopEditableMcpScope; label: string }> = [
  { value: 'user', label: '用户' },
  { value: 'project', label: '项目 .mcp.json' },
  { value: 'local', label: '本地项目配置' },
]

const TYPE_OPTIONS: Array<{ value: McpTransportTemplate; label: string }> = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'http' },
  { value: 'sse', label: 'sse' },
  { value: 'ws', label: 'ws' },
]

const READONLY_SCOPES = new Set(['enterprise', 'managed', 'dynamic', 'claudeai'])

type FormState = {
  originalName: string
  name: string
  scope: DesktopEditableMcpScope
  type: McpTransportTemplate
  configText: string
}

const EMPTY_FORM: FormState = {
  originalName: '',
  name: '',
  scope: 'user',
  type: 'stdio',
  configText: formatConfig(templateConfig('stdio')),
}

export function McpSettings(): React.ReactNode {
  const [servers, setServers] = useState<DesktopMcpServerListItem[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadServers()
  }, [])

  const selectedServer = useMemo(
    () => servers.find(server => server.name === form.originalName),
    [form.originalName, servers],
  )

  async function loadServers(): Promise<void> {
    setBusy(true)
    try {
      setServers(await desktopClient.listMcpServers())
      setError(null)
    } catch (loadError) {
      setError(errorMessageOf(loadError))
    } finally {
      setBusy(false)
    }
  }

  function startCreate(type: McpTransportTemplate = 'stdio'): void {
    setForm({
      originalName: '',
      name: '',
      scope: 'user',
      type,
      configText: formatConfig(templateConfig(type)),
    })
    setStatus(null)
    setError(null)
  }

  function startEdit(server: DesktopMcpServerListItem): void {
    if (!server.editable) return
    setForm({
      originalName: server.name,
      name: server.name,
      scope: server.scope as DesktopEditableMcpScope,
      type: editableTransport(server.type),
      configText: formatConfig(server.config),
    })
    setStatus(null)
    setError(null)
  }

  function updateType(type: McpTransportTemplate): void {
    setForm(current => ({
      ...current,
      type,
      configText: formatConfig(templateConfig(type)),
    }))
  }

  async function saveServer(): Promise<void> {
    const name = form.name.trim()
    if (!name) {
      setError('请输入 MCP server 名称。')
      return
    }

    let config: Record<string, unknown>
    try {
      const parsed = JSON.parse(form.configText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('配置必须是 JSON object。')
      }
      config = parsed as Record<string, unknown>
    } catch (parseError) {
      setError(`JSON 无法解析：${errorMessageOf(parseError)}`)
      return
    }

    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const nextServers = await desktopClient.saveMcpServer({
        originalName: form.originalName || undefined,
        name,
        scope: form.scope,
        config,
      })
      setServers(nextServers)
      setForm(EMPTY_FORM)
      setStatus('MCP server 已保存。新会话会使用更新后的配置。')
    } catch (saveError) {
      setError(errorMessageOf(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function removeServer(server: DesktopMcpServerListItem): Promise<void> {
    if (!server.removable) return
    if (!window.confirm(`删除 MCP server "${server.name}"？`)) return
    setBusy(true)
    setError(null)
    try {
      const nextServers = await desktopClient.removeMcpServer(
        server.name,
        server.scope as DesktopEditableMcpScope,
      )
      setServers(nextServers)
      if (form.originalName === server.name) setForm(EMPTY_FORM)
      setStatus('MCP server 已删除。')
    } catch (removeError) {
      setError(errorMessageOf(removeError))
    } finally {
      setBusy(false)
    }
  }

  async function toggleServer(
    server: DesktopMcpServerListItem,
    enabled: boolean,
  ): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setServers(await desktopClient.setMcpServerEnabled(server.name, enabled))
      setStatus(enabled ? 'MCP server 已启用。' : 'MCP server 已停用。')
    } catch (toggleError) {
      setError(errorMessageOf(toggleError))
    } finally {
      setBusy(false)
    }
  }

  const formTitle = form.originalName ? '编辑 MCP server' : '新增 MCP server'

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">MCP 服务器</h2>
        <p className="settings-page-desc">
          管理 Model Context Protocol 连接。用户、项目和本地 scope 可编辑；企业、插件和动态来源仅展示。
        </p>

        <SettingsSection
          title="服务器"
          description={error ?? status ?? `已配置 ${servers.length} 个 MCP server。`}
          actions={
            <div className="settings-inline-actions">
              <button className="settings-button" type="button" onClick={() => void loadServers()}>
                刷新
              </button>
              <button className="settings-button primary" type="button" onClick={() => startCreate()}>
                <Plus size={APP_ICON_SIZE} />
                <span>新增</span>
              </button>
            </div>
          }
        >
          {servers.length === 0 ? (
            <p className="settings-empty-state">暂无 MCP server。</p>
          ) : (
            servers.map(server => (
              <article className="mcp-server-row" key={`${server.scope}:${server.name}`}>
                <div className="mcp-server-copy">
                  <div className="mcp-server-title-line">
                    <h4>{server.name}</h4>
                    <span className="settings-chip">{server.scope}</span>
                    <span className="settings-chip">{server.type}</span>
                    {READONLY_SCOPES.has(server.scope) ? (
                      <span className="settings-chip">只读</span>
                    ) : null}
                  </div>
                  <p>{server.summary || '未提供命令或 URL。'}</p>
                </div>
                <div className="mcp-server-actions">
                  <ToggleSwitch
                    checked={server.enabled}
                    onChange={enabled => void toggleServer(server, enabled)}
                    ariaLabel={`启停 ${server.name}`}
                  />
                  <button
                    className="settings-button"
                    disabled={!server.editable || busy}
                    type="button"
                    onClick={() => startEdit(server)}
                  >
                    <Pencil size={APP_ICON_SIZE} />
                    <span>编辑</span>
                  </button>
                  <button
                    className="settings-button danger"
                    disabled={!server.removable || busy}
                    type="button"
                    onClick={() => void removeServer(server)}
                  >
                    <Trash2 size={APP_ICON_SIZE} />
                    <span>删除</span>
                  </button>
                </div>
              </article>
            ))
          )}
        </SettingsSection>

        <SettingsSection
          title={formTitle}
          description={
            selectedServer && !selectedServer.editable
              ? '该 MCP server 来自只读 scope，不能编辑。'
              : '使用模板快速开始，也可以直接编辑高级 JSON。'
          }
        >
          <SettingsRow
            title="名称"
            description="只能包含字母、数字、短横线和下划线。"
            control={
              <input
                className="settings-input settings-input-narrow"
                value={form.name}
                placeholder="server-name"
                onChange={event =>
                  setForm(current => ({ ...current, name: event.target.value }))
                }
              />
            }
          />
          <SettingsRow
            title="Scope"
            description="user 写入全局配置；project 写入 .mcp.json；local 写入当前项目本地配置。"
            control={
              <SettingsDropdown
                value={form.scope}
                options={SCOPE_OPTIONS}
                onChange={value =>
                  setForm(current => ({
                    ...current,
                    scope: value as DesktopEditableMcpScope,
                  }))
                }
                ariaLabel="MCP scope"
              />
            }
          />
          <SettingsRow
            title="模板"
            description="切换模板会替换下方 JSON。"
            control={
              <SettingsDropdown
                value={form.type}
                options={TYPE_OPTIONS}
                onChange={value => updateType(value as McpTransportTemplate)}
                ariaLabel="MCP 类型"
              />
            }
          />
          <SettingsRow
            title="高级 JSON"
            description="提交前会使用现有 MCP schema 校验。"
            control={
              <textarea
                className="settings-textarea settings-code-textarea"
                rows={8}
                spellCheck={false}
                value={form.configText}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    configText: event.target.value,
                  }))
                }
              />
            }
          />
          <SettingsRow
            title="操作"
            description={busy ? '正在保存...' : '保存后新会话会读取更新后的 MCP 配置。'}
            control={
              <div className="settings-inline-actions">
                <button
                  className="settings-button"
                  type="button"
                  onClick={() => setForm(EMPTY_FORM)}
                >
                  重置
                </button>
                <button
                  className="settings-button primary"
                  disabled={busy}
                  type="button"
                  onClick={() => void saveServer()}
                >
                  保存
                </button>
              </div>
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
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
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error ?? '未知错误')
}
