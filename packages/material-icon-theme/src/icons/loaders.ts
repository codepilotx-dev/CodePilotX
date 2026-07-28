// Generated from material-icon-theme@5.37.0 by scripts/sync-upstream.ts.
// Do not edit directly.

import type { ComponentType } from "react"
import type { MaterialSvgIconProps } from "./create-icon"
import type { IconName } from "./names"

export type IconComponent = ComponentType<MaterialSvgIconProps>
export type IconShard = Readonly<Partial<Record<IconName, IconComponent>>>

const shardLoaders = [
  () => import("./shard-0"),
  () => import("./shard-1"),
  () => import("./shard-2"),
  () => import("./shard-3"),
  () => import("./shard-4"),
  () => import("./shard-5"),
  () => import("./shard-6"),
  () => import("./shard-7"),
  () => import("./shard-8"),
  () => import("./shard-9"),
  () => import("./shard-a"),
  () => import("./shard-b"),
  () => import("./shard-c"),
  () => import("./shard-d"),
  () => import("./shard-e"),
  () => import("./shard-f"),
] as const

export function iconShard(iconName: IconName): number {
  let hash = 2_166_136_261
  for (let index = 0; index < iconName.length; index += 1) {
    hash ^= iconName.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % shardLoaders.length
}

export async function loadIconShard(iconName: IconName): Promise<IconShard> {
  const module = await shardLoaders[iconShard(iconName)]()
  return module.iconComponents as IconShard
}
