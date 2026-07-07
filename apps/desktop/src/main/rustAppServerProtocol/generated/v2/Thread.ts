// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/Thread.ts
import type { Turn } from './Turn.js'
import type { ThreadStatus } from './ThreadStatus.js'
import type { AbsolutePathBuf } from '../AbsolutePathBuf.js'
export type Thread = {
  id: string
  sessionId: string
  preview: string
  ephemeral: boolean
  modelProvider: string
  createdAt: number
  updatedAt: number
  status: ThreadStatus
  cwd: AbsolutePathBuf
  turns: Array<Turn>
  name: string | null
}
