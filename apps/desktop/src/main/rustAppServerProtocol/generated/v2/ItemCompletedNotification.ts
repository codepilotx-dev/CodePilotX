// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/ItemCompletedNotification.ts
import type { ThreadItem } from './ThreadItem.js'
import type { TurnStatus } from './TurnStatus.js'
export type ItemCompletedNotification = {
  threadId: string
  turnId: string
  item: ThreadItem
  turnStatus: TurnStatus
}
