/**
 * System service provider 注册表。
 *
 * - 默认实现 = 现有代码路径（不预注册 provider；无激活 provider 时行为不变）；
 * - System 插件激活成功后将 providers 注册进来（覆盖默认）；
 * - 查询失败返回 null 表示回退默认实现；
 * - 默认 Profile 一致性：无激活 provider 时所有调用保持原语义。
 */

export class SystemServiceRegistry {
  private readonly providers = new Map<string, unknown>()
  private readonly owners = new Map<string, string>()

  /** System 插件激活后注册 provider（覆盖默认实现）。 */
  registerActivated(pluginId: string, key: string, instance: unknown): void {
    this.providers.set(key, instance)
    this.owners.set(key, pluginId)
  }

  /** 查询 provider；null = 使用默认实现。 */
  resolve<T = unknown>(key: string): T | null {
    return (this.providers.get(key) as T | undefined) ?? null
  }

  /** provider 归属（插件 id）；null = 默认实现。 */
  providerOf(key: string): string | null {
    return this.owners.get(key) ?? null
  }

  /** 全部已激活 provider 摘要（诊断/UI）。 */
  summary(): Array<{ key: string; pluginId: string }> {
    return [...this.owners.entries()].map(([key, pluginId]) => ({ key, pluginId }))
  }

  dispose(): void {
    this.providers.clear()
    this.owners.clear()
  }
}
