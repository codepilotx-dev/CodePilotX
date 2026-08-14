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
  global: [
    'catalog/updated',
    'provider/credential/updated',
    'config/updated',
    'workspace/file/changed',
    'workspace/git/changed',
  ],
} as const satisfies Readonly<
  Record<
    'canonical' | 'provider' | 'modelHealth' | 'skills' | 'tooling' | 'mcp' | 'taskboard' | 'global',
    readonly LiveEventType[]
  >
>
