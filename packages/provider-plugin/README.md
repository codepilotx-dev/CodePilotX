# @codepilotx/provider-plugin

Effect-based host for statically imported provider plugins.

```ts
import { Effect } from "effect"
import { createPluginHost, define } from "@codepilotx/provider-plugin"

const plugin = define({
  id: "builtin-openai",
  init: (context) =>
    Effect.gen(function* () {
      yield* context.catalog.transform((catalog) => {
        // Transform the mutable draft in place.
      })
    }),
})

const host = createPluginHost({ builtins: [plugin] })
await Effect.runPromise(host.init())
```

`init`, hook execution, catalog transforms, and `dispose` preserve built-in and
registration order. This package deliberately has no npm/file resolver, dynamic
import, installer, or API for evaluating third-party plugin code.
