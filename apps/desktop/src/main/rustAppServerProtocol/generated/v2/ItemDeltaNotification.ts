// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/ItemDeltaNotification.ts
import type { TurnStatus } from './TurnStatus.js'
export type ItemDeltaNotification = {
  threadId: string
  turnId: string
  itemId: string
  itemDelta: { text?: string; phase?: 'commentary' | 'final_answer' }
  turnStatus: TurnStatus
}
