// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts
import type { UserInput } from './UserInput.js'
export type TurnStartParams = {
  threadId: string
  clientUserMessageId?: string | null
  input: Array<UserInput>
  model?: string | null
  cwd?: string | null
}
