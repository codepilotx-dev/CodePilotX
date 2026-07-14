import type { Effect } from "effect"
import type { AuthHooks, IntegrationHooks } from "./integration"
import type { ProviderCatalogHooks } from "./catalog"
import type { HookSpec, PluginHooks } from "./registration"

export interface PluginContext<Spec extends HookSpec = HookSpec> {
  readonly hooks: PluginHooks<Spec>
  readonly catalog: ProviderCatalogHooks
  readonly integration: IntegrationHooks
  readonly auth: AuthHooks
  readonly onDispose: (callback: () => Effect.Effect<void, unknown> | void) => Effect.Effect<void>
}

export interface Plugin<Spec extends HookSpec = HookSpec> {
  readonly id: string
  readonly init: (context: PluginContext<Spec>) => Effect.Effect<void, unknown> | void
  readonly dispose?: () => Effect.Effect<void, unknown> | void
}

export function define<
  Spec extends HookSpec = HookSpec,
  const P extends Plugin<Spec> = Plugin<Spec>,
>(plugin: P): P {
  return plugin
}
