import React, { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { MarkdownMessage } from '../../markdown/MarkdownMessage.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { WorkbenchTabDescriptor } from '../dock/rightDockState.js'
import type { WorkbenchTabAvailability } from './workbenchTabRegistry.js'

export type PluginViewTab = Extract<WorkbenchTabDescriptor, { kind: 'plugin-view' }>

/**
 * Host-owned 声明式插件视图节点白名单。
 * 只允许 section/markdown/status/table/form/actions；任何其他节点被拒绝。
 * 禁止 HTML、CSS、React 组件、JavaScript 与任意 URL iframe。
 */
export type PluginViewNode =
  | { kind: 'section'; title?: string; children: unknown[] }
  | { kind: 'markdown'; content: string }
  | { kind: 'status'; text: string; tone?: 'default' | 'success' | 'warning' | 'danger' }
  | { kind: 'table'; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, string>> }
  | {
      kind: 'form'
      actionId: string
      submitLabel?: string
      fields: Array<{ key: string; label: string; control: 'string' | 'multiline' | 'boolean'; value?: unknown }>
    }
  | { kind: 'actions'; items: Array<{ id: string; label: string; tone?: 'default' | 'danger' }> }

const KNOWN_NODE_KINDS = new Set(['section', 'markdown', 'status', 'table', 'form', 'actions'])

export function isPluginViewNode(value: unknown): value is PluginViewNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  if (typeof node.kind !== 'string' || !KNOWN_NODE_KINDS.has(node.kind)) return false
  const isRecord = (item: unknown): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
  switch (node.kind) {
    case 'section':
      return (node.title === undefined || typeof node.title === 'string')
        && Array.isArray(node.children)
        && node.children.every(isPluginViewNode)
    case 'markdown':
      return typeof node.content === 'string'
    case 'status':
      return typeof node.text === 'string'
        && (node.tone === undefined || ['default', 'success', 'warning', 'danger'].includes(node.tone as string))
    case 'table':
      return Array.isArray(node.columns)
        && Array.isArray(node.rows)
        && (node.columns as unknown[]).every(column => isRecord(column) && typeof column.key === 'string' && typeof column.label === 'string')
        && (node.rows as unknown[]).every(row => isRecord(row))
    case 'form':
      return typeof node.actionId === 'string'
        && (node.submitLabel === undefined || typeof node.submitLabel === 'string')
        && Array.isArray(node.fields)
        && (node.fields as unknown[]).every(field => isRecord(field) && typeof field.key === 'string' && typeof field.label === 'string' && ['string', 'multiline', 'boolean'].includes(field.control as string))
    case 'actions':
      return Array.isArray(node.items)
        && (node.items as unknown[]).every(item => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string')
  }
}

export function validatePluginViewNodes(nodes: readonly unknown[]): PluginViewNode[] {
  const valid: PluginViewNode[] = []
  for (const node of nodes) {
    if (!isPluginViewNode(node)) continue
    if (node.kind === 'section') {
      const children = Array.isArray(node.children) ? node.children : []
      const filtered = children.filter(isPluginViewNode)
      if (filtered.length !== children.length) continue
      valid.push({ ...node, children: filtered })
      continue
    }
    valid.push(node)
  }
  return valid
}

export function PluginViewPane({
  tab,
  availability,
  onViewInvalidated,
}: {
  tab: PluginViewTab
  availability?: WorkbenchTabAvailability
  onViewInvalidated?: () => void
}): React.ReactNode {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'ready'; nodes: PluginViewNode[] }
    | { phase: 'error'; message: string }
  >({ phase: 'loading' })
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (availability?.status === 'unavailable') {
      return () => { cancelled = true }
    }
    setState({ phase: 'loading' })
    void desktopClient.renderPluginView({
      pluginId: tab.pluginId,
      viewId: tab.viewId,
      instanceId: tab.instanceId,
    }).then(result => {
      if (cancelled) return
      setState({ phase: 'ready', nodes: validatePluginViewNodes(result.nodes) })
    }).catch(error => {
      if (cancelled) return
      setState({ phase: 'error', message: error instanceof Error ? error.message : '插件视图加载失败。' })
    })
    return () => { cancelled = true }
  }, [tab.pluginId, tab.viewId, tab.instanceId, reloadVersion, availability?.status])

  useEffect(() => {
    if (availability?.status === 'available') {
      // 插件 runtime 状态变化时由调用方触发刷新。
    }
  }, [availability?.status])

  if (availability?.status === 'unavailable') {
    return (
      <div className="tw:flex tw:h-full tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:p-6 tw:text-center">
        <AlertTriangle aria-hidden="true" size={APP_ICON_SIZE + 4} strokeWidth={APP_ICON_STROKE_WIDTH} className="tw:text-app-text-soft" />
        <p className="tw:m-0 tw:text-sm tw:text-app-text-soft">
          {availability.reason ?? '插件视图当前不可用。'}
        </p>
        <Button color="secondary" onClick={() => setReloadVersion(value => value + 1)}>
          <RefreshCw aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          重新加载
        </Button>
      </div>
    )
  }

  if (state.phase === 'loading') {
    return (
      <div aria-label="正在加载插件视图" className="tw:grid tw:gap-2 tw:p-4" role="status">
        {[0, 1, 2].map(index => (
          <div
            aria-hidden="true"
            className="tw:h-16 tw:animate-pulse tw:rounded-md tw:bg-app-panel tw:motion-reduce:animate-none"
            key={index}
          />
        ))}
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="tw:flex tw:h-full tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:p-6 tw:text-center" role="alert">
        <AlertTriangle aria-hidden="true" size={APP_ICON_SIZE + 4} strokeWidth={APP_ICON_STROKE_WIDTH} className="tw:text-app-danger" />
        <p className="tw:m-0 tw:text-sm tw:text-app-text-soft">{state.message}</p>
        <Button color="secondary" onClick={() => setReloadVersion(value => value + 1)}>
          <RefreshCw aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          重试
        </Button>
      </div>
    )
  }

  if (state.phase === 'ready') {
    return (
      <div className="tw:flex tw:h-full tw:flex-col tw:gap-3 tw:overflow-y-auto tw:p-4">
        {state.nodes.length === 0 ? (
          <p className="tw:m-0 tw:text-sm tw:text-app-text-soft">插件视图为空。</p>
        ) : (
          state.nodes.map((node, index) => (
            <PluginViewNodeRenderer
              key={index}
              node={node}
              context={{ pluginId: tab.pluginId, viewId: tab.viewId, instanceId: tab.instanceId }}
              onAction={() => {
                onViewInvalidated?.()
                setReloadVersion(value => value + 1)
              }}
              onError={(message) => setState({ phase: 'error', message })}
            />
          ))
        )}
      </div>
    )
  }

  return null
}

function PluginViewNodeRenderer({
  node,
  context,
  onAction,
  onError,
}: {
  node: PluginViewNode
  context: { pluginId: string; viewId: string; instanceId: string }
  onAction: () => void
  onError: (message: string) => void
}): React.ReactNode {
  switch (node.kind) {
    case 'section':
      return (
        <section className="tw:grid tw:gap-2">
          {node.title ? <h3 className="tw:m-0 tw:text-sm tw:font-[var(--font-weight-label)] tw:text-app-text">{node.title}</h3> : null}
          {(node.children as PluginViewNode[]).map((child, index) => (
            <PluginViewNodeRenderer key={index} node={child} context={context} onAction={onAction} onError={onError} />
          ))}
        </section>
      )
    case 'markdown':
      return <MarkdownMessage text={node.content} />
    case 'status': {
      const tone = node.tone === 'success'
        ? 'tw:bg-app-success/15 tw:text-app-success'
        : node.tone === 'warning'
          ? 'tw:bg-[color:var(--color-warning)]/15 tw:text-[color:var(--color-warning)]'
          : node.tone === 'danger'
            ? 'tw:bg-app-danger/15 tw:text-app-danger'
            : 'tw:bg-app-panel tw:text-app-text-soft'
      return (
        <span className={`tw:inline-flex tw:w-fit tw:rounded-full tw:px-2 tw:py-0.5 tw:text-xs ${tone}`}>
          {node.text}
        </span>
      )
    }
    case 'table':
      return (
        <table className="tw:w-full tw:border-collapse tw:text-sm">
          <thead>
            <tr>
              {node.columns.map(column => (
                <th
                  className="tw:border-b tw:border-app-border tw:px-2 tw:py-1.5 tw:text-left tw:font-[var(--font-weight-label)] tw:text-app-text-soft"
                  key={column.key}
                  scope="col"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row, index) => (
              <tr key={index}>
                {node.columns.map(column => (
                  <td className="tw:border-b tw:border-app-border/50 tw:px-2 tw:py-1.5 tw:text-app-text" key={column.key}>
                    {row[column.key] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'form':
      return <PluginViewForm node={node} context={context} onAction={onAction} onError={onError} />
    case 'actions':
      return (
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          {node.items.map(item => (
            <Button
              color={item.tone === 'danger' ? 'danger' : 'secondary'}
              key={item.id}
              onClick={() => {
                void runViewAction(context, item.id, {}, onAction, onError)
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )
  }
}

function PluginViewForm({
  node,
  context,
  onAction,
  onError,
}: {
  node: Extract<PluginViewNode, { kind: 'form' }>
  context: { pluginId: string; viewId: string; instanceId: string }
  onAction: () => void
  onError: (message: string) => void
}): React.ReactNode {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(node.fields.map(field => [field.key, field.value])),
  )
  return (
    <form
      className="tw:grid tw:gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void runViewAction(context, node.actionId, values, onAction, onError)
      }}
    >
      {node.fields.map(field => (
        <label className="tw:grid tw:gap-1 tw:text-sm tw:text-app-text" key={field.key}>
          <span>{field.label}</span>
          {field.control === 'boolean' ? (
            <input
              checked={values[field.key] === true}
              className="tw:h-4 tw:w-4"
              onChange={(event) => setValues(current => ({ ...current, [field.key]: event.target.checked }))}
              type="checkbox"
            />
          ) : field.control === 'multiline' ? (
            <textarea
              className="tw:min-h-20 tw:rounded-md tw:border tw:border-app-border tw:bg-app-panel tw:px-2 tw:py-1.5"
              onChange={(event) => setValues(current => ({ ...current, [field.key]: event.target.value }))}
              value={String(values[field.key] ?? '')}
            />
          ) : (
            <input
              className="tw:rounded-md tw:border tw:border-app-border tw:bg-app-panel tw:px-2 tw:py-1.5"
              onChange={(event) => setValues(current => ({ ...current, [field.key]: event.target.value }))}
              value={String(values[field.key] ?? '')}
            />
          )}
        </label>
      ))}
      <div>
        <Button color="primary" type="submit">{node.submitLabel ?? '提交'}</Button>
      </div>
    </form>
  )
}

async function runViewAction(
  context: { pluginId: string; viewId: string; instanceId: string },
  actionId: string,
  params: unknown,
  onAction: () => void,
  onError: (message: string) => void,
): Promise<void> {
  try {
    const safeParams = params === undefined || Object.keys(params as Record<string, unknown>).length === 0
      ? undefined
      : params as unknown as Json
    await desktopClient.runPluginViewAction({
      pluginId: context.pluginId,
      viewId: context.viewId,
      instanceId: context.instanceId,
      actionId,
      ...(safeParams === undefined ? {} : { params: safeParams }),
    })
    onAction()
  } catch (error) {
    onError(error instanceof Error ? error.message : '插件视图动作失败。')
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
