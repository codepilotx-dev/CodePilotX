import { Capabilities } from "@codepilotx/agent-protocol"
import type { AgentDatabase } from "../../../storage/database/AgentDatabase"
import {
  probeArtifactsStorageCapabilities,
  probeThreadsStorageCapabilities,
} from "../../../storage/database/storage-capabilities"

/**
 * 实际初始化处理器边界使用的 capability 过滤。
 *
 * 集中探测 history 库中的可选存储能力：
 * - `threads.creation_surface` 列存在：返回完整 `Capabilities`；缺失时剔除
 *   `thread.creation-surface.v1`，避免在无法持久化的库上虚假广告。
 * - `item_artifacts` 表存在：保留 `artifacts.read.v1`；缺失时剔除，保持旧库
 *   只读兼容（绝不 ALTER 或降级 user_version）。
 *
 * 单独抽出此函数可被单元测试直接调用、与 system.initialize 处理器共享同一过滤实现。
 */
export function filterAdvertisedCapabilities(db: AgentDatabase): string[] {
  const { creationSurface } = probeThreadsStorageCapabilities(db.sqlite)
  const { itemArtifactsTable } = probeArtifactsStorageCapabilities(db.sqlite)
  return Capabilities.filter(
    (capability) =>
      (capability !== "thread.creation-surface.v1" || creationSurface)
      && (capability !== "artifacts.read.v1" || itemArtifactsTable),
  )
}