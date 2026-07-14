# Upstream

This package is adapted from OpenCode's in-process plugin APIs and host implementation:

- `packages/plugin/src/v2/effect/`
- `packages/opencode/src/plugin/index.ts` (`4495d8730a87a0b40509be27bdd432b53a8c4c914dfcba4121e3651b3e649555`)
- `packages/opencode/src/plugin/openai/codex.ts` (`d45533d80269f959bd8eb403b288d78be5064ff9e6523dc6af01ed2a788ef064`)
- `packages/opencode/src/plugin/github-copilot/copilot.ts` (`e56fce8c0722e09838b72158f5b375dd628095404bd95249c37862dce931278e`)

Upstream source: `https://github.com/anomalyco/opencode`

The adaptation keeps the MIT license in `LICENSE.opencode` and intentionally narrows the design:

- only plugins passed directly through `createPluginHost({ builtins })` are accepted;
- initialization, hook execution, catalog transforms, and disposal preserve registration order;
- provider catalog types are based on `@codepilotx/model-schema`;
- integration and authentication capabilities are explicit in-process registrations;
- npm installation, file resolution, dynamic import, and external plugin execution are not included.

Local implementation files are all files under `src/`, including the
statically linked `src/builtins/` OAuth implementations.
