/**
 * Rust app-server protocol adapter — re-exports minimal generated types
 * needed by the desktop runtime integration.
 *
 * Do not import generated files directly from business code.
 */
export type { InitializeParams } from './generated/InitializeParams.js'
export type { InitializeCapabilities } from './generated/InitializeCapabilities.js'
export type { InitializeResponse } from './generated/InitializeResponse.js'
export type { ClientInfo } from './generated/ClientInfo.js'
export type { AbsolutePathBuf } from './generated/AbsolutePathBuf.js'
export type * as v2 from './generated/v2/index.js'
export type {
  ThreadStartResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  UserInput,
  Thread,
  Turn,
  ThreadItem,
  AgentMessageThreadItem,
  TurnStatus,
  TurnError,
  ThreadStartedNotification,
  TurnStartedNotification,
  TurnCompletedNotification,
  ItemDeltaNotification,
  ItemCompletedNotification,
  ErrorNotification,
} from './generated/v2/index.js'
export type {
  ThreadStartParams,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
  ThreadDeleteParams,
  ThreadDeleteResponse,
  ThreadSetNameParams,
  ThreadSetNameResponse,
  ThreadSettingsUpdateParams,
  ThreadSettingsUpdateResponse,
  TurnSteerParams,
  TurnSteerResponse,
  ThreadCompactStartParams,
  ThreadCompactStartResponse,
  ThreadRollbackParams,
  ThreadRollbackResponse,
  ThreadGoalStatus,
  ThreadGoal,
  ThreadGoalSetParams,
  ThreadGoalSetResponse,
  ThreadGoalGetParams,
  ThreadGoalGetResponse,
  ThreadGoalClearParams,
  ThreadGoalClearResponse,
  ThreadGoalUpdatedNotification,
  ThreadGoalClearedNotification,
  ThreadSettings,
  ThreadSettingsUpdatedNotification,
  ReviewTarget,
  ReviewStartParams,
  ReviewStartResponse,
} from './appServerMethods.js'
export type * from './appServerCatalogMethods.js'
