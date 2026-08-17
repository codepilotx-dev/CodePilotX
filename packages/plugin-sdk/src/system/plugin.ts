/**
 * System/Profile 插件定义框架（进程内 TypeScript/Bun ABI）。
 *
 * System 插件是 Agent 进程内完全可信代码（非沙箱），可以替换业务 service
 * provider 并改变默认安全语义；但不能改变 thread-rpc-v4 wire 与 Electron
 * 安全外壳（固定元内核）。生命周期为 process lifetime：register 返回的
 * disposer 在 Agent shutdown 时按注册逆序释放。
 */

import type { JsonValue } from "../json-schema"
import type { SystemServiceKey } from "./contracts"

export interface SystemPluginIdentity {
  /** 固定 plugin id（publisher 命名空间）。 */
  pluginId: string
  version: string
  /** 应用中的 Profile id；默认 profile 使用 "default"。 */
  profileId: string
}

/** 插件运行时上下文。scope 语义与 Agent Runtime Scope 对齐：逆序释放、幂等。 */
export interface SystemPluginContext {
  identity: SystemPluginIdentity
  /** 进程生命周期 abort signal。 */
  readonly signal: AbortSignal
  /** 注册一个随进程生命周期逆序释放的 disposer。 */
  add(disposer: () => void | Promise<void>): void
  /** 插件只读配置（System Profile config）。 */
  readonly config: JsonValue
  /**
   * 本插件专属 namespaced 数据根（Host 已创建、内容归本插件所有）；
   * 持久化类 Provider（如 session-persistence）只能在此根内读写，
   * 不得触碰默认 AgentDatabase / profile / history 文件。
   */
  readonly dataRoot: string
  /** 声明依赖的 system service 的运行时访问器（由 Host 在激活前解析）。 */
  dependencies: ReadonlyMap<SystemServiceKey, unknown>
  /**
   * 注册本插件提供的一个 System service provider 实例。
   * 全部 required 依赖解析与 provider 注册完成后，Host 才把 generation
   * 标记为 active/last-good；注册失败或缺失的 provider 会使激活失败。
   */
  registerProvider(key: SystemServiceKey, instance: unknown): void
  /** 面向用户的安全日志。 */
  log(entry: { level: "debug" | "info" | "warn" | "error"; message: string }): void
}

/** System 插件声明。 */
export interface SystemPluginDefinition {
  id: string
  version: string
  displayName: string
  description?: string
  /** 本插件提供（实现）的 system service key 列表。 */
  provides?: readonly SystemServiceKey[]
  /** 依赖的 system service key -> 版本范围（缺失阻止 Profile staging）。 */
  requires?: Readonly<Record<SystemServiceKey, string>>
  /**
   * 激活入口：注册 provider 与 disposer。
   * 返回值是补充 disposer；Host 侧的注册 API 仍由 Host 持有 disposer。
   */
  register(context: SystemPluginContext): void | (() => void | Promise<void>)
}

export function defineSystemPlugin(definition: SystemPluginDefinition): SystemPluginDefinition {
  if (!definition.id.includes(".")) {
    throw new Error(`System 插件 id 必须是 publisher 命名空间：${definition.id}`)
  }
  const result: SystemPluginDefinition = {
    id: definition.id,
    version: definition.version,
    displayName: definition.displayName,
    register: definition.register,
  }
  if (definition.description !== undefined) result.description = definition.description
  if (definition.provides !== undefined) result.provides = Object.freeze([...definition.provides])
  if (definition.requires !== undefined) result.requires = definition.requires
  return Object.freeze(result)
}
