// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/Turn.ts
import type { ThreadItem } from './ThreadItem.js'
import type { TurnError } from './TurnError.js'
import type { TurnStatus } from './TurnStatus.js'
export type Turn = {
  id: string
  items: Array<ThreadItem>
  status: TurnStatus
  error: TurnError | null
  startedAt: number | null
  completedAt: number | null
  durationMs: number | null
}
