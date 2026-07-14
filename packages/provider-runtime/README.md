# @codepilotx/provider-runtime

Production AI SDK provider aggregation for CodePilotX.

```ts
import { createProviderRuntime } from "@codepilotx/provider-runtime"

const providers = createProviderRuntime({
  cachePath: ".codepilotx/models.json",
  snapshot: bundledModelsDevSnapshot,
  config: userProviderConfig,
  credentials: credentialStore,
})

const available = await providers.list()
const models = await providers.models(available[0]?.id)
const model = await providers.resolve({ providerID: available[0]!.id, id: models[0]!.id })
const language = await providers.getLanguage({ providerID: model.providerID, id: model.id })

await providers.refresh()
await providers.dispose()
```

Catalog loading uses disk, then the supplied snapshot, then `models.dev`.
Refreshes use a five-minute disk freshness window and run every 60 minutes while
the runtime is active. Provider packages are restricted to the exported static
`BUNDLED_PROVIDERS` allowlist or loaders supplied explicitly by the host. The
runtime never installs npm packages.

API keys and OAuth access tokens must come from `env` or `credentials`.
`authorization`, `x-api-key`, and `api-key` headers are rejected in catalogs,
plugins, config, and custom options.
