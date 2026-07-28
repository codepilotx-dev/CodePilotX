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
  skills: ['skill/updated'],
  tooling: ['tooling/updated'],
  mcp: ['mcp/updated'],
  global: [
    'catalog/updated',
    'provider/credential/updated',
    'config/updated',
    'workspace/file/changed',
    'workspace/git/changed',
  ],
} as const satisfies Readonly<
  Record<
    'canonical' | 'provider' | 'skills' | 'tooling' | 'mcp' | 'global',
    readonly LiveEventType[]
  >
>
