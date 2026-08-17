import type { RpcResult } from '@codepilotx/agent-protocol'

export type RequestSnapshotSummary = RpcResult<'runtime/request-snapshot/list'>['items'][number]

/**
 * 增量 created event 合并：新快照插入顶部并按 id 去重，
 * 已存在项保留原位置（重连对账由 list 全量替换完成）。
 */
export function mergeCreatedRequestSnapshots(
  current: readonly RequestSnapshotSummary[],
  incoming: readonly RequestSnapshotSummary[],
): RequestSnapshotSummary[] {
  const seen = new Set<string>()
  return [...incoming, ...current].filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/** 请求检查器入口门禁：记录开启、capability 可用且存在真实任务。 */
export function requestInspectorAvailability(input: {
  enabled: boolean
  capabilityAvailable: boolean
  threadId: string | null
}): 'available' | 'unavailable' {
  return input.enabled && input.capabilityAvailable && input.threadId
    ? 'available'
    : 'unavailable'
}

export type ModelRequestAvailability =
  | { status: 'loading' }
  | { status: 'enabled' }
  | { status: 'disabled'; reason: 'setting' | 'capability' | 'thread' }

/** 统一 availability：gate 解析完成前为 loading；disabled 时给出确定性原因。 */
export function modelRequestAvailability(input: {
  loading: boolean
  enabled: boolean
  capabilityAvailable: boolean
  threadId: string | null
}): ModelRequestAvailability {
  if (input.loading) return { status: 'loading' }
  if (!input.enabled) return { status: 'disabled', reason: 'setting' }
  if (!input.capabilityAvailable) return { status: 'disabled', reason: 'capability' }
  if (!input.threadId) return { status: 'disabled', reason: 'thread' }
  return { status: 'enabled' }
}

/**
 * 从 config 对象读取 diagnostics.model_request_snapshots.enabled；
 * 只有严格布尔值 true 才视为开启（字符串/数字等一律关闭）。
 */
export function modelRequestSnapshotsEnabledFromConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false
  const diagnostics = (config as Record<string, unknown>)['diagnostics']
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) return false
  const section = (diagnostics as Record<string, unknown>)['model_request_snapshots']
  if (!section || typeof section !== 'object' || Array.isArray(section)) return false
  return (section as Record<string, unknown>)['enabled'] === true
}
