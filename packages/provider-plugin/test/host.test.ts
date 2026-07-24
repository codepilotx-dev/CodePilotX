import { describe, expect, test } from "bun:test"
import type { Integration, Model, Provider } from "@codepilotx/model-schema"
import { Effect } from "effect"
import { createPluginHost, define, type HookSpec, type Plugin, type ProviderCatalog } from "../src"

interface TestHooks extends HookSpec {
  readonly mutate: {
    readonly input: { readonly amount: number }
    readonly output: { value: number }
  }
}

describe("provider plugin host", () => {
  test("runs init, hooks, and disposal sequentially", async () => {
    const events: string[] = []
    const plugin = (id: string): Plugin<TestHooks> =>
      define<TestHooks>({
        id,
        init: (context) =>
          Effect.gen(function* () {
            events.push(`init:${id}`)
            yield* context.hooks.on("mutate", (input, output) => {
              events.push(`hook:${id}`)
              output.value += input.amount
            })
            yield* context.onDispose(() => {
              events.push(`finalize:${id}`)
            })
          }),
        dispose: () => {
          events.push(`dispose:${id}`)
        },
      })

    const host = createPluginHost<TestHooks>({ builtins: [plugin("first"), plugin("second")] })
    await Effect.runPromise(host.init())
    expect((await Effect.runPromise(host.list())).map((item) => item.id)).toEqual(["first", "second"])

    const output = await Effect.runPromise(host.trigger("mutate", { amount: 2 }, { value: 0 }))
    expect(output.value).toBe(4)
    await Effect.runPromise(host.dispose())

    expect(events).toEqual([
      "init:first",
      "init:second",
      "hook:first",
      "hook:second",
      "dispose:first",
      "finalize:first",
      "dispose:second",
      "finalize:second",
    ])
  })

  test("applies catalog transforms in registration order without mutating the source", async () => {
    const providerID = "example" as Provider.ID
    const modelID = "example-model" as Model.ID
    const integrationID = "example" as Integration.ID
    const keyMethod: Integration.KeyMethod = { type: "key", label: "API key" }
    const source: ProviderCatalog = {
      providers: new Map([
        [
          providerID,
          {
            provider: {
              id: providerID,
              name: "example",
              api: { type: "native", settings: {} },
              request: { headers: {}, body: {} },
            },
            models: new Map(),
          },
        ],
      ]),
    }
    const host = createPluginHost({
      builtins: [
        define({
          id: "catalog",
          init: (context) =>
            Effect.gen(function* () {
              yield* context.catalog.transform((catalog) => {
                catalog.provider.update(providerID, (provider) => {
                  provider.name += " one"
                })
              })
              yield* context.catalog.transform((catalog) => {
                catalog.provider.update(providerID, (provider) => {
                  provider.name += " two"
                })
              })
              yield* context.integration.register({
                id: integrationID,
                name: "Example",
                methods: [keyMethod],
                connections: [],
              })
              yield* context.auth.register({ integrationID, method: keyMethod })
            }),
        }),
      ],
    })

    await Effect.runPromise(host.init())
    const transformed = await Effect.runPromise(host.transformProviderCatalog(source))
    expect(source.providers.get(providerID)?.provider.name).toBe("example")
    expect(transformed.providers.get(providerID)?.provider.name).toBe("example one two")
    expect((await Effect.runPromise(host.integrations())).map((item) => item.id)).toEqual([integrationID])
    expect(await Effect.runPromise(host.authRegistrations(integrationID))).toHaveLength(1)
  })
})
