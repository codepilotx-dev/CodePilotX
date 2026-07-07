// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/ErrorNotification.ts
import type { TurnError } from './TurnError.js'
export type ErrorNotification = {
  threadId?: string
  turnId?: string
  error: TurnError
}
