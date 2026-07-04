/**
 * appServer 服务器类 —— 从 core 统一 re-export。
 *
 * `JsonRpcAppServer` 类由 `@codepilotx/core/appServer/server.js` 定义，
 * 使用 registry 模式将协议调度与运行时实现解耦。
 *
 * TUI 通过 `createAppServer()` 工厂创建预绑定了 TUI 默认 registry
 * （即 `AppServerThreadRegistry`）的服务器实例。
 */
export { JsonRpcAppServer } from '@codepilotx/core/appServer/server.js'

export type {
  JsonRpcAppServerOptions,
  JsonRpcAppServerRegistry,
} from '@codepilotx/core/appServer/server.js'

import { JsonRpcAppServer, type JsonRpcAppServerOptions } from '@codepilotx/core/appServer/server.js'
import { AppServerThreadRegistry } from './registry.js'

/**
 * 创建一个预绑定了 TUI 默认 registry 的 JsonRpcAppServer 实例。
 *
 * 与 core 的 `new JsonRpcAppServer()` 不同（默认使用 unsupportedRegistry()），
 * 此工厂直接注入 `AppServerThreadRegistry`，使 sidecar 进程开箱即可
 * 使用真实的 ThreadRuntime。
 */
export function createAppServer(
  options?: JsonRpcAppServerOptions,
): JsonRpcAppServer {
  return new JsonRpcAppServer(new AppServerThreadRegistry(), options)
}
