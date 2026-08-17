import type { LiveEventType } from '@codepilotx/agent-protocol'

export const AGENT_LIVE_EVENT_FILTERS = {
  canonical: [
    'item/agentMessage/delta',
    'reasoning/textDelta',
    'reasoning/summaryPartAdded',
    'reasoning/summaryTextDelta',
    'plan/delta',
    'tool/outputDelta',
  ],
  provider: [
    'catalog/updated',
    'provider/credential/updated',
    'usage/source/updated',
  ],
  /** Health workspace subscription: batch events plus the catalog/credential
   * changes that invalidate existing results. */
  modelHealth: [
    'model/health/updated',
    'catalog/updated',
    'provider/credential/updated',
  ],
  skills: ['skill/updated'],
  tooling: ['tooling/updated'],
  mcp: ['mcp/updated'],
  // taskboard/changed is durable and therefore arrives independently of the
  // live-only filter. Keep a named preset so the feature does not subscribe to
  // unrelated high-volume live deltas.
  taskboard: [],
  // runtime/request-snapshot/created 是 durable 事件；只订阅增量刷新，
  // 重连对账由 list 完成。
  requestSnapshots: [],
  // 插件 inventory/operation 是 live 事件；runtime-status 变化也驱动刷新。
  plugins: [
    'plugin/inventory-changed',
    'plugin/operation-updated',
    'plugin/runtime-status-changed',
  ],
  global: [
    'catalog/updated',
    'provider/credential/updated',
    'config/updated',
    'workspace/file/changed',
    'workspace/git/changed',
  ],
} as const satisfies Readonly<
  Record<
    'canonical' | 'provider' | 'modelHealth' | 'skills' | 'tooling' | 'mcp' | 'taskboard' | 'requestSnapshots' | 'plugins' | 'global',
    readonly LiveEventType[]
  >
>
