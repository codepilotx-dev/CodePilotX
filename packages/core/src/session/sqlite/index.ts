export { SessionDatabase } from './database.js'
export { runMigrations } from './migrations.js'
export {
  listSessions,
  getSession,
  countSessions,
  sessionExists,
} from './queries.js'
export {
  upsertSession,
  touchRecencyAt,
  deleteSession,
} from './sync.js'
export { backfillSessions, isBackfillComplete } from './backfill.js'
export type {
  SessionRow,
  SessionUpsert,
  ListSessionsParams,
  ListSessionsResult,
  Cursor,
  SortKey,
  SortDirection,
} from './types.js'
export type { SessionOverlay } from './backfill.js'
