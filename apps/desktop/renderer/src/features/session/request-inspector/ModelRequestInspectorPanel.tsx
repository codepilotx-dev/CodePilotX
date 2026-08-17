import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Download, RefreshCw, FileSearch } from 'lucide-react'
import type { EventEnvelope, RpcResult } from '@codepilotx/agent-protocol'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../../services/desktop-client/eventSubscriptionFilters.js'
import {
  WorkbenchPanelEmpty,
  WorkbenchPanelError,
  WorkbenchPanelLoading,
  WorkbenchPanelUnavailable,
} from '../../layout/panels/WorkbenchPanelStates.js'
import { Button } from '../../../components/ui/Button.js'
import { formatAttachmentText } from '../attachments/UserAttachmentPreviewPanel.js'
import { mergeCreatedRequestSnapshots, type RequestSnapshotSummary } from './requestInspectorModel.js'

type RequestSnapshotDetail = RpcResult<'runtime/request-snapshot/read'>['snapshot']

type StoredRuntimeManifest = {
  version?: number
  presetID?: string
  contributions?: Array<{ id: string; version: number }>
  promptHash?: string
  toolCatalogHash?: string
  toolNames?: string[]
  manifestHash?: string
}

const parseRuntimeManifest = (raw: string): StoredRuntimeManifest => {
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as StoredRuntimeManifest)
      : {}
  } catch {
    return {}
  }
}

const formatByteSize = (sizeBytes: number): string => {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function ModelRequestInspectorPanel({
  threadId,
}: {
  threadId: string
}): React.ReactNode {
  const [capabilityAvailable, setCapabilityAvailable] = useState<boolean | null>(null)
  const [items, setItems] = useState<RequestSnapshotSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RequestSnapshotDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [detailReload, setDetailReload] = useState(0)
  const generationRef = useRef(0)

  const loadList = useCallback(async (cursor?: string) => {
    if (!threadId) return
    const generation = generationRef.current
    try {
      const result = await desktopClient.listRequestSnapshots({
        threadId,
        ...(cursor ? { cursor } : {}),
        limit: 50,
      })
      if (generation !== generationRef.current) return
      setItems(current => cursor
        ? [...current, ...result.items.filter(item => !current.some(existing => existing.id === item.id))]
        : [...result.items])
      setNextCursor(result.nextCursor ?? null)
      setError(null)
    } catch (cause) {
      if (generation !== generationRef.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [threadId])

  const reset = useCallback(() => {
    generationRef.current += 1
    setItems([])
    setNextCursor(null)
    setSelectedId(null)
    setDetail(null)
    setDetailError(null)
    setError(null)
    setLoading(true)
  }, [])

  useEffect(() => {
    let mounted = true
    reset()
    setCapabilityAvailable(null)
    void desktopClient.getRuntimeCapabilities().then(capabilities => {
      if (!mounted) return
      setCapabilityAvailable(capabilities.includes('runtime.request-snapshots.v1'))
    }).catch(() => {
      if (mounted) setCapabilityAvailable(false)
    })
    void loadList()
    return () => { mounted = false }
  }, [reset, loadList, threadId])

  // 增量刷新：created event 到达时插入顶部；重连后以 list 对账。
  useEffect(() => {
    if (!threadId) return undefined
    return desktopClient.subscribeAgentEventEnvelopes(
      {
        threadId,
        liveEventTypes: AGENT_LIVE_EVENT_FILTERS.requestSnapshots,
        onReplayComplete: () => { void loadList() },
        onCursorExpired: () => { void loadList() },
      },
      (envelopes: readonly EventEnvelope[]) => {
        // durable event 载荷位于 envelope.payload.snapshot（判别收窄，非 params）。
        const created = envelopes.flatMap(envelope =>
          envelope.type === 'runtime/request-snapshot/created'
            ? [envelope.payload.snapshot]
            : [],
        )
        if (created.length === 0) return
        setItems(current => mergeCreatedRequestSnapshots(current, created))
      },
    )
  }, [threadId, loadList])

  useEffect(() => {
    if (!threadId || !selectedId) {
      setDetail(null)
      setDetailError(null)
      return
    }
    let mounted = true
    setDetailLoading(true)
    setDetailError(null)
    void desktopClient.readRequestSnapshot({ threadId, snapshotId: selectedId })
      .then(result => {
        if (!mounted) return
        setDetail(result.snapshot)
      })
      .catch(cause => {
        if (!mounted) return
        setDetail(null)
        setDetailError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (mounted) setDetailLoading(false)
      })
    return () => { mounted = false }
  }, [threadId, selectedId, detailReload])

  const copyPayload = useCallback(async () => {
    if (!detail?.payloadJson) return
    try {
      await navigator.clipboard.writeText(detail.payloadJson)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }, [detail])

  const exportPayload = useCallback(async () => {
    if (!detail?.payloadJson || !detail) return
    try {
      await desktopClient.saveAttachmentToDownloads({
        kind: 'text',
        name: `codepilotx-request-${detail.id}.json`,
        mediaType: 'application/json',
        encoding: 'utf8',
        data: detail.payloadJson,
      })
    } catch {
      // 导出失败保持面板可用；不抛给渲染层。
    }
  }, [detail])

  if (capabilityAvailable === false) {
    return (
      <WorkbenchPanelUnavailable
        title="请求检查器不可用"
        description="当前 Agent 未协商 runtime.request-snapshots.v1 能力，无法读取请求快照。"
      />
    )
  }
  if (!threadId) {
    return (
      <WorkbenchPanelEmpty
        title="请先创建任务"
        description="请求检查器会绑定到当前任务的主 Agent 与子 Agent 请求。"
      />
    )
  }
  if (loading && items.length === 0 && !error) {
    return <WorkbenchPanelLoading label="正在读取请求快照…" />
  }
  if (error && items.length === 0) {
    return (
      <WorkbenchPanelError
        title="请求快照读取失败"
        message={error}
        retryable
        onRetry={() => { setLoading(true); void loadList() }}
      />
    )
  }
  if (items.length === 0) {
    return (
      <WorkbenchPanelEmpty
        title="暂无请求记录"
        description="在桌面设置中开启“记录完整模型请求”后，新的 Provider 请求会在此显示。"
      />
    )
  }

  const manifest = detail ? parseRuntimeManifest(detail.runtimeManifest) : null
  const selected = items.find(item => item.id === selectedId) ?? null

  return (
    <div className="request-inspector">
      <section className="request-inspector__list" aria-label="请求列表">
        <div className="request-inspector__list-header">
          <span>请求记录</span>
          <Button
            color="secondary"
            aria-label="刷新请求列表"
            onClick={() => { setLoading(true); void loadList() }}
          >
            <RefreshCw size={14} />
          </Button>
        </div>
        <ul className="request-inspector__items">
          {items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                className={`request-inspector__item${item.id === selectedId ? ' is-selected' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="request-inspector__item-title">
                  <FileSearch size={13} />
                  #{item.requestOrdinal} {item.providerId}/{item.modelId}
                </span>
                <span className="request-inspector__item-meta">
                  {item.agentId} · {formatTime(item.createdAt)}
                  {item.status === 'captured' && item.payloadBytes !== null
                    ? ` · ${formatByteSize(item.payloadBytes)}`
                    : ' · 缺失'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {nextCursor && (
          <div className="request-inspector__list-footer">
            <Button color="secondary" onClick={() => void loadList(nextCursor)}>
              加载更多
            </Button>
          </div>
        )}
      </section>
      <section className="request-inspector__detail" aria-label="请求详情">
        {!selected ? (
          <WorkbenchPanelEmpty
            title="选择一条请求"
            description="查看发送给 Provider 的脱敏完整 payload 与运行时清单。"
          />
        ) : detailLoading ? (
          <WorkbenchPanelLoading label="正在读取请求详情…" />
        ) : detailError ? (
          <WorkbenchPanelError
            title="请求详情读取失败"
            message={detailError}
            retryable
            onRetry={() => setDetailReload(v => v + 1)}
          />
        ) : !detail ? null : detail.status === 'missing' ? (
          <div className="request-inspector__missing">
            <h2>本次请求未能重建快照</h2>
            <p>请求已继续发送，但没有可保存的 payload（{detail.errorCode}）。</p>
          </div>
        ) : (
          <div className="request-inspector__captured">
            <div className="request-inspector__detail-header">
              <div>
                <h2>#{detail.requestOrdinal} {detail.providerId}/{detail.modelId}</h2>
                <p>{detail.api} · {formatTime(detail.createdAt)}</p>
              </div>
              <div className="request-inspector__actions">
                <Button
                  color="secondary"
                  disabled={!detail.payloadJson}
                  onClick={() => void copyPayload()}
                >
                  <Copy size={14} />
                  {copied ? '已复制' : '复制 JSON'}
                </Button>
                <Button
                  color="secondary"
                  disabled={!detail.payloadJson}
                  onClick={() => void exportPayload()}
                >
                  <Download size={14} />
                  导出 JSON
                </Button>
              </div>
            </div>
            {manifest && (
              <dl className="request-inspector__manifest">
                <div>
                  <dt>Runtime 预设</dt>
                  <dd>{manifest.presetID ?? '未知'}</dd>
                </div>
                <div>
                  <dt>贡献版本</dt>
                  <dd>
                    {(manifest.contributions ?? [])
                      .map(contribution => `${contribution.id}@${contribution.version}`)
                      .join(', ') || '—'}
                  </dd>
                </div>
                <div>
                  <dt>Prompt 哈希</dt>
                  <dd>{manifest.promptHash ?? '—'}</dd>
                </div>
                <div>
                  <dt>工具目录哈希</dt>
                  <dd>{manifest.toolCatalogHash ?? '—'}</dd>
                </div>
                <div>
                  <dt>清单哈希</dt>
                  <dd>{manifest.manifestHash ?? '—'}</dd>
                </div>
              </dl>
            )}
            <div className="request-inspector__payload-meta">
              <span>SHA-256：{detail.payloadSha256}</span>
              <span>大小：{detail.payloadBytes !== null ? formatByteSize(detail.payloadBytes) : '—'}</span>
            </div>
            <pre className="request-inspector__payload">
              {formatAttachmentText(detail.payloadJson ?? '', 'request.json', 'application/json').text}
            </pre>
          </div>
        )}
      </section>
    </div>
  )
}
