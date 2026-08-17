/**
 * Application 插件 service dependency graph。
 *
 * 规则（SDK ABI 冻结）：
 * - required 缺失 → 该插件 waiting（不启动 runner）；
 * - required cycle → 拒绝 staging 并返回循环路径；
 * - optional 缺失不阻止启动；
 * - singleton service 多 provider → provider conflict（拒绝 staging）。
 */

export type PluginRuntimeStatus = "waiting" | "active" | "retiring" | "crashed" | "disabled"

export interface StagedPluginServiceDeclaration {
  pluginId: string
  /** 完整 key（含 @major）。 */
  key: string
  version: string
  singleton: boolean
}

export interface StagedPluginRequirement {
  pluginId: string
  /** required 或 optional */
  kind: "required" | "optional"
  key: string
  /** provider 版本范围。 */
  range: string
}

export interface ServiceGraphNode {
  pluginId: string
  provides: StagedPluginServiceDeclaration[]
  requires: StagedPluginRequirement[]
}

export interface ServiceGraphResult {
  /** 拓扑序（provider 先于 consumer）；包含 waiting 与 conflict 排除后的可启动集合。 */
  activationOrder: string[]
  /** required 缺失 → waiting。 */
  waiting: Array<{ pluginId: string; missingKeys: string[] }>
  /** singleton 冲突。 */
  conflicts: Array<{ key: string; providers: string[] }>
  /** cycle：返回参与循环的插件 id 列表（含路径）。 */
  cycles: Array<{ pluginIds: string[] }>
  /** provider 依赖映射：key（含 @major）→ provider pluginId。 */
  providersByKey: Map<string, string>
}

/** service key 的 major 匹配（consumer 引用 key 必须与 provider key 完全一致）。 */
const sameServiceKey = (a: string, b: string) => a === b

export function buildServiceGraph(nodes: readonly ServiceGraphNode[]): ServiceGraphResult {
  const providersByKey = new Map<string, string>()
  const conflicts: ServiceGraphResult["conflicts"] = []
  for (const node of nodes) {
    for (const declaration of node.provides) {
      const existing = providersByKey.get(declaration.key)
      if (existing !== undefined && existing !== node.pluginId) {
        // singleton 冲突只对 singleton 声明生效；非 singleton 允许多 provider。
        const bothSingleton = nodes.find((n) => n.pluginId === existing)?.provides.find((d) => d.key === declaration.key)?.singleton !== false
          && declaration.singleton
        if (bothSingleton) {
          const current = conflicts.find((c) => c.key === declaration.key)
          if (current) {
            if (!current.providers.includes(node.pluginId)) current.providers.push(node.pluginId)
          } else {
            conflicts.push({ key: declaration.key, providers: [existing, node.pluginId] })
          }
          continue
        }
      }
      if (!providersByKey.has(declaration.key)) {
        providersByKey.set(declaration.key, node.pluginId)
      }
    }
  }

  const waiting: ServiceGraphResult["waiting"] = []
  const blocked = new Set<string>()
  for (const node of nodes) {
    const missingKeys = node.requires
      .filter((requirement) => requirement.kind === "required")
      .map((requirement) => requirement.key)
      .filter((key) => !providersByKey.has(key))
    if (missingKeys.length > 0) {
      waiting.push({ pluginId: node.pluginId, missingKeys })
      blocked.add(node.pluginId)
    }
  }

  // 冲突 provider 视为不可用：任何依赖该 key 的 required consumer 也 waiting。
  for (const conflict of conflicts) {
    for (const node of nodes) {
      const required = node.requires.some((requirement) =>
        requirement.kind === "required" && sameServiceKey(requirement.key, conflict.key))
      if (required && !blocked.has(node.pluginId)) {
        waiting.push({ pluginId: node.pluginId, missingKeys: [conflict.key] })
        blocked.add(node.pluginId)
      }
    }
  }

  // DFS 找 cycle（在未被 blocked 的节点间）。
  const cycles: ServiceGraphResult["cycles"] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(nodes.map((node) => [node.pluginId, node] as const))
  const dfs = (pluginId: string, path: string[]): void => {
    if (visited.has(pluginId)) return
    if (visiting.has(pluginId)) {
      const start = path.indexOf(pluginId)
      const loop = start >= 0 ? path.slice(start) : path
      if (loop.length > 1 && !cycles.some((c) => c.pluginIds.join(",") === loop.join(","))) {
        cycles.push({ pluginIds: loop })
      }
      return
    }
    visiting.add(pluginId)
    path.push(pluginId)
    const node = byId.get(pluginId)
    if (node) {
      for (const requirement of node.requires) {
        const provider = providersByKey.get(requirement.key)
        if (provider && provider !== pluginId && !blocked.has(provider)) {
          dfs(provider, path)
        }
      }
    }
    path.pop()
    visiting.delete(pluginId)
    visited.add(pluginId)
  }
  for (const node of nodes) {
    if (!blocked.has(node.pluginId)) dfs(node.pluginId, [])
  }
  const cyclePlugins = new Set(cycles.flatMap((cycle) => cycle.pluginIds))
  for (const pluginId of cyclePlugins) blocked.add(pluginId)

  // 拓扑排序（Kahn）：provider 先于 consumer。
  const activationOrder: string[] = []
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const node of nodes) {
    if (blocked.has(node.pluginId)) continue
    indegree.set(node.pluginId, 0)
    dependents.set(node.pluginId, [])
  }
  for (const node of nodes) {
    if (blocked.has(node.pluginId)) continue
    for (const requirement of node.requires) {
      const provider = providersByKey.get(requirement.key)
      if (provider && provider !== node.pluginId && indegree.has(provider) && indegree.has(node.pluginId)) {
        indegree.set(node.pluginId, (indegree.get(node.pluginId) ?? 0) + 1)
        dependents.get(provider)!.push(node.pluginId)
      }
    }
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([pluginId]) => pluginId)
    .sort()
  while (queue.length > 0) {
    const pluginId = queue.shift()!
    activationOrder.push(pluginId)
    for (const dependent of dependents.get(pluginId) ?? []) {
      const next = (indegree.get(dependent) ?? 1) - 1
      indegree.set(dependent, next)
      if (next === 0) queue.push(dependent)
    }
    queue.sort()
  }
  // cycle 中无法入列的节点已被 blocked 覆盖。

  return { activationOrder, waiting, conflicts, cycles, providersByKey }
}
