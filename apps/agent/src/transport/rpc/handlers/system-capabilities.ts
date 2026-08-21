import { Capabilities } from "@codepilotx/agent-protocol"
import type { AgentDatabase } from "../../../storage/database/AgentDatabase"
import { probeThreadsStorageCapabilities } from "../../../storage/database/storage-capabilities"

/**
 * 实际初始化处理器边界使用的 capability 过滤。
 *
 * 集中探测 history 库中 `threads.creation_surface` 列是否存在：
 * - 列存在：返回完整 `Capabilities`；
 * - 列缺失：剔除 `thread.creation-surface.v1`，避免在无法持久化的库上虚假广告。
 *
 * 单独抽出此函数可被单元测试直接调用、与 system.initialize 处理器共享同一过滤实现。
 */
export function filterAdvertisedCapabilities(db: AgentDatabase): string[] {
  const { creationSurface } = probeThreadsStorageCapabilities(db.sqlite)
  if (creationSurface) return [...Capabilities]
  return Capabilities.filter(
    (capability) => capability !== "thread.creation-surface.v1",
  )
}