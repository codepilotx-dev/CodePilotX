import { Capabilities, type ProtocolCapability } from "@codepilotx/agent-protocol"
import type { AgentDatabase } from "../../../storage/database/AgentDatabase"
import {
  probeArtifactsStorageCapabilities,
  probeThreadsStorageCapabilities,
} from "../../../storage/database/storage-capabilities"

/**
 * 探测服务端实际支持的能力子集，按 serverAvailable 稳定顺序返回。
 *
 * 集中探测 history 库中的可选存储能力：
 * - `threads.creation_surface` 列存在：返回完整 `Capabilities`；缺失时剔除
 *   `thread.creation-surface.v1`，避免在无法持久化的库上虚假广告。
 * - `item_artifacts` 表存在：保留 `artifacts.read.v1`；缺失时剔除，保持旧库
 *   只读兼容（绝不 ALTER 或降级 user_version）。
 */
export function filterAdvertisedCapabilities(db: AgentDatabase): ReadonlyArray<ProtocolCapability> {
  const { creationSurface } = probeThreadsStorageCapabilities(db.sqlite)
  const { itemArtifactsTable } = probeArtifactsStorageCapabilities(db.sqlite)
  return Capabilities.filter(
    (capability): capability is ProtocolCapability =>
      (capability !== "thread.creation-surface.v1" || creationSurface)
      && (capability !== "artifacts.read.v1" || itemArtifactsTable),
  )
}

/**
 * 计算客户端请求与服务端可用能力的交集。
 * 返回结果为 `clientRequested ∩ serverAvailable`，顺序与 serverAvailable 一致。
 */
export function negotiateCapabilities(
  clientRequested: Iterable<ProtocolCapability>,
  serverAvailable: ReadonlyArray<ProtocolCapability>,
): ReadonlySet<ProtocolCapability> {
  const clientSet = new Set(clientRequested)
  const negotiated = new Set<ProtocolCapability>()
  for (const cap of serverAvailable) {
    if (clientSet.has(cap)) {
      negotiated.add(cap)
    }
  }
  return negotiated
}