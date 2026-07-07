// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartResponse.ts
import type { Thread } from './Thread.js'
import type { AbsolutePathBuf } from '../AbsolutePathBuf.js'
export type ThreadStartResponse = {
  thread: Thread
  model: string
  modelProvider: string
  cwd: AbsolutePathBuf
  approvalPolicy: string
}
