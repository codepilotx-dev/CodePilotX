import type { Integration } from "@codepilotx/model-schema"
import { Effect } from "effect"
import { makeProviderCatalogDraft, type ProviderCatalog, type ProviderCatalogTransform } from "./catalog"
import type { AuthConnectionResolver, AuthRegistration } from "./integration"
import type { Plugin, PluginContext } from "./plugin"
import type { HookSpec, Registration } from "./registration"

type AnyHookCallback = (input: unknown, output: unknown) => Effect.Effect<void, unknown> | void

interface OwnedRegistration {
  active: boolean
  readonly dispose: () => void
}

interface LoadedPlugin<Spec extends HookSpec> {
  readonly plugin: Plugin<Spec>
  readonly registrations: OwnedRegistration[]
  readonly finalizers: Array<() => Effect.Effect<void, unknown> | void>
}

export class PluginHostError extends Error {
  readonly _tag = "PluginHostError"

  constructor(
    readonly reason: "duplicate-plugin" | "not-initialized" | "disposed",
    message: string,
  ) {
    super(message)
    this.name = "PluginHostError"
  }
}

export interface PluginHostOptions<Spec extends HookSpec> {
  readonly builtins: readonly Plugin<Spec>[]
  readonly connection?: AuthConnectionResolver
}

export interface PluginHost<Spec extends HookSpec> {
  readonly init: () => Effect.Effect<void, unknown>
  readonly list: () => Effect.Effect<readonly Plugin<Spec>[]>
  readonly trigger: <Name extends keyof Spec & string>(
    name: Name,
    input: Spec[Name]["input"],
    output: Spec[Name]["output"],
  ) => Effect.Effect<Spec[Name]["output"], unknown>
  readonly transformProviderCatalog: (catalog: ProviderCatalog) => Effect.Effect<ProviderCatalog, unknown>
  readonly integrations: () => Effect.Effect<readonly Integration.Info[], PluginHostError>
  readonly authRegistrations: (
    integrationID?: Integration.ID,
  ) => Effect.Effect<readonly AuthRegistration[], PluginHostError>
  readonly dispose: () => Effect.Effect<void, unknown>
}

function runOptional(effect: Effect.Effect<void, unknown> | void): Effect.Effect<void, unknown> {
  return effect ?? Effect.void
}

export function createPluginHost<Spec extends HookSpec = HookSpec>(
  options: PluginHostOptions<Spec>,
): PluginHost<Spec> {
  const loaded: LoadedPlugin<Spec>[] = []
  const hooks = new Map<string, AnyHookCallback[]>()
  const catalogTransforms: ProviderCatalogTransform[] = []
  const integrationRegistrations: Integration.Info[] = []
  const authRegistrations: AuthRegistration[] = []
  let initialized = false
  let disposed = false

  const remove = <T>(items: T[], item: T) => {
    const index = items.indexOf(item)
    if (index >= 0) items.splice(index, 1)
  }

  const register = (owner: LoadedPlugin<Spec>, dispose: () => void): Registration => {
    const owned: OwnedRegistration = { active: true, dispose }
    owner.registrations.push(owned)
    return {
      dispose: Effect.sync(() => {
        if (!owned.active) return
        owned.active = false
        dispose()
        remove(owner.registrations, owned)
      }),
    }
  }

  const context = (owner: LoadedPlugin<Spec>): PluginContext<Spec> => ({
    hooks: {
      on: (name, callback) =>
        Effect.sync(() => {
          const callbacks = hooks.get(name) ?? []
          const registered = callback as AnyHookCallback
          callbacks.push(registered)
          hooks.set(name, callbacks)
          return register(owner, () => {
            remove(callbacks, registered)
            if (callbacks.length === 0) hooks.delete(name)
          })
        }),
    },
    catalog: {
      transform: (callback) =>
        Effect.sync(() => {
          catalogTransforms.push(callback)
          return register(owner, () => remove(catalogTransforms, callback))
        }),
    },
    integration: {
      register: (integration) =>
        Effect.sync(() => {
          integrationRegistrations.push(integration)
          return register(owner, () => remove(integrationRegistrations, integration))
        }),
      list: () => Effect.sync(() => integrationRegistrations.slice()),
    },
    auth: {
      register: (auth) =>
        Effect.sync(() => {
          authRegistrations.push(auth)
          return register(owner, () => remove(authRegistrations, auth))
        }),
      list: (integrationID) =>
        Effect.sync(() =>
          integrationID
            ? authRegistrations.filter((registration) => registration.integrationID === integrationID)
            : authRegistrations.slice(),
        ),
      connection: {
        active: (integrationID) => options.connection?.active(integrationID) ?? Effect.succeed(undefined),
        resolve: (connection) => options.connection?.resolve(connection) ?? Effect.succeed(undefined),
      },
    },
    onDispose: (callback) =>
      Effect.sync(() => {
        owner.finalizers.push(callback)
      }),
  })

  const ensureActive = () => {
    if (disposed) return Effect.fail(new PluginHostError("disposed", "Plugin host has been disposed"))
    if (!initialized) return Effect.fail(new PluginHostError("not-initialized", "Plugin host has not been initialized"))
    return Effect.void
  }

  const disposeLoaded = (entries: readonly LoadedPlugin<Spec>[]) =>
    Effect.gen(function* () {
      for (const entry of entries) {
        if (entry.plugin.dispose) yield* runOptional(entry.plugin.dispose())
        for (const finalizer of entry.finalizers) yield* runOptional(finalizer())
        for (const registration of entry.registrations.slice()) {
          if (!registration.active) continue
          registration.active = false
          registration.dispose()
        }
        entry.registrations.length = 0
      }
    })

  return {
    init: () =>
      Effect.gen(function* () {
        if (disposed) return yield* Effect.fail(new PluginHostError("disposed", "Plugin host has been disposed"))
        if (initialized) return

        const ids = new Set<string>()
        for (const plugin of options.builtins) {
          if (ids.has(plugin.id)) {
            return yield* Effect.fail(
              new PluginHostError("duplicate-plugin", `Duplicate built-in plugin id: ${plugin.id}`),
            )
          }
          ids.add(plugin.id)
        }

        for (const plugin of options.builtins) {
          const entry: LoadedPlugin<Spec> = { plugin, registrations: [], finalizers: [] }
          loaded.push(entry)
          yield* runOptional(plugin.init(context(entry)))
        }
        initialized = true
      }),
    list: () => Effect.sync(() => loaded.map((entry) => entry.plugin)),
    trigger: (name, input, output) =>
      Effect.gen(function* () {
        yield* ensureActive()
        const callbacks = hooks.get(name) ?? []
        for (const callback of callbacks) yield* runOptional(callback(input, output))
        return output
      }),
    transformProviderCatalog: (catalog) =>
      Effect.gen(function* () {
        yield* ensureActive()
        const editor = makeProviderCatalogDraft(catalog)
        for (const transform of catalogTransforms) yield* runOptional(transform(editor.draft))
        return editor.finish()
      }),
    integrations: () =>
      Effect.gen(function* () {
        yield* ensureActive()
        return integrationRegistrations.slice()
      }),
    authRegistrations: (integrationID) =>
      Effect.gen(function* () {
        yield* ensureActive()
        return integrationID
          ? authRegistrations.filter((registration) => registration.integrationID === integrationID)
          : authRegistrations.slice()
      }),
    dispose: () =>
      Effect.gen(function* () {
        if (disposed) return
        disposed = true
        yield* disposeLoaded(loaded)
        hooks.clear()
        catalogTransforms.length = 0
        integrationRegistrations.length = 0
        authRegistrations.length = 0
      }),
  }
}
