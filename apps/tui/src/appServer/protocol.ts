/**
 * appServer 协议类型 —— 从 core 统一 re-export。
 *
 * 所有 JSON-RPC 协议常量、通知名称、请求/响应类型、fixture 工具函数
 * 均由 `@codepilotx/core/appServer/protocol.js` 定义。此文件确保 TUI 层
 * 不再持有重复的协议定义，所有消费方直接使用 core 的权威类型。
 *
 * TUI 特有的扩展类型（如 ThreadRuntime 相关的 Settings）保持在
 * registry.ts（适配层）内部，不混入协议层。
 */
export {
  APP_SERVER_PROTOCOL_VERSION,
  THREAD_EVENT_NOTIFICATION,
  SESSION_SNAPSHOT_UPDATED_NOTIFICATION,
  APP_SERVER_METHODS,
  createInitializeResult,
  createJsonRpcProtocolFixtures,
} from '@codepilotx/core/appServer/protocol.js'

export type {
  JsonRpcAppServerMethod,
  JsonRpcThreadRuntimeSettings,
  JsonRpcThreadRuntimeState,
  JsonRpcThreadRuntimeResumeState,
  JsonRpcThreadRuntimeForkOptions,
  JsonRpcInitializeResult,
  JsonRpcThreadStartParams,
  JsonRpcThreadStartResult,
  JsonRpcThreadResumeParams,
  JsonRpcThreadForkParams,
  JsonRpcTurnStartParams,
  JsonRpcTurnStartResult,
  JsonRpcTurnInterruptParams,
  JsonRpcTurnRollbackParams,
  JsonRpcItemInjectParams,
  JsonRpcSessionGetSnapshotParams,
  JsonRpcSessionSnapshot,
  JsonRpcThreadEventNotificationParams,
  JsonRpcSessionSnapshotUpdatedNotificationParams,
  JsonRpcErrorData,
} from '@codepilotx/core/appServer/protocol.js'
