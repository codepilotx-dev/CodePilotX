import { describe, expect, test } from 'bun:test'
import {
  mergeCreatedRequestSnapshots,
  modelRequestAvailability,
  modelRequestSnapshotsEnabledFromConfig,
  requestInspectorAvailability,
  type RequestSnapshotSummary,
} from '../src/features/session/request-inspector/requestInspectorModel.js'

const summary = (id: string, createdAt: number): RequestSnapshotSummary => ({
  id,
  threadId: 'thread:1',
  turnId: 'turn:1',
  agentId: 'agent:1',
  requestOrdinal: 0,
  providerId: 'openai',
  api: 'openai-responses',
  modelId: 'gpt-test',
  status: 'captured',
  payloadBytes: 10,
  payloadSha256: 'a'.repeat(64),
  errorCode: null,
  createdAt,
})

describe('请求检查器模型', () => {
  test('增量 created event 插入顶部并按 id 去重', () => {
    const current = [summary('snapshot:2', 200), summary('snapshot:1', 100)]
    const merged = mergeCreatedRequestSnapshots(current, [
      summary('snapshot:3', 300),
      summary('snapshot:2', 200),
    ])
    expect(merged.map(item => item.id)).toEqual([
      'snapshot:3',
      'snapshot:2',
      'snapshot:1',
    ])
    expect(mergeCreatedRequestSnapshots([], [summary('a', 1), summary('a', 1)]))
      .toEqual([summary('a', 1)])
  })

  test('门禁：记录开启、capability 可用且存在真实任务才显示入口', () => {
    expect(requestInspectorAvailability({
      enabled: true,
      capabilityAvailable: true,
      threadId: 'thread:1',
    })).toBe('available')
    expect(requestInspectorAvailability({
      enabled: false,
      capabilityAvailable: true,
      threadId: 'thread:1',
    })).toBe('unavailable')
    expect(requestInspectorAvailability({
      enabled: true,
      capabilityAvailable: false,
      threadId: 'thread:1',
    })).toBe('unavailable')
    expect(requestInspectorAvailability({
      enabled: true,
      capabilityAvailable: true,
      threadId: null,
    })).toBe('unavailable')
  })

  test('统一 availability：解析前 loading，disabled 带确定性原因', () => {
    expect(modelRequestAvailability({
      loading: true,
      enabled: true,
      capabilityAvailable: true,
      threadId: 'thread:1',
    })).toEqual({ status: 'loading' })
    expect(modelRequestAvailability({
      loading: false,
      enabled: true,
      capabilityAvailable: true,
      threadId: 'thread:1',
    })).toEqual({ status: 'enabled' })
    expect(modelRequestAvailability({
      loading: false,
      enabled: false,
      capabilityAvailable: true,
      threadId: 'thread:1',
    })).toEqual({ status: 'disabled', reason: 'setting' })
    expect(modelRequestAvailability({
      loading: false,
      enabled: true,
      capabilityAvailable: false,
      threadId: 'thread:1',
    })).toEqual({ status: 'disabled', reason: 'capability' })
    expect(modelRequestAvailability({
      loading: false,
      enabled: true,
      capabilityAvailable: true,
      threadId: null,
    })).toEqual({ status: 'disabled', reason: 'thread' })
  })

  test('配置读取只有严格布尔 true 才启用', () => {
    expect(modelRequestSnapshotsEnabledFromConfig({
      diagnostics: { model_request_snapshots: { enabled: true } },
    })).toBe(true)
    expect(modelRequestSnapshotsEnabledFromConfig({
      diagnostics: { model_request_snapshots: { enabled: false } },
    })).toBe(false)
    expect(modelRequestSnapshotsEnabledFromConfig({
      diagnostics: { model_request_snapshots: { enabled: 'true' } },
    })).toBe(false)
    expect(modelRequestSnapshotsEnabledFromConfig({
      diagnostics: { model_request_snapshots: { enabled: 1 } },
    })).toBe(false)
    expect(modelRequestSnapshotsEnabledFromConfig({})).toBe(false)
    expect(modelRequestSnapshotsEnabledFromConfig(null)).toBe(false)
    expect(modelRequestSnapshotsEnabledFromConfig({
      diagnostics: { model_request_snapshots: 'enabled' },
    })).toBe(false)
  })
})
