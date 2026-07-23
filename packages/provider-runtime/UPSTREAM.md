# Upstream Source

This package adapts OpenCode 1.17.13 provider runtime behavior from the local
reference checkout at `D:\GitHubProject\Agent\opencode-dev`.

Primary source files:

- `packages/opencode/src/provider/provider.ts` (`2ffc38be4f98f364d4903a0a9e99f8e915b14edaf239da3bf56d6a8ebc0b78d9`)
- `packages/opencode/src/provider/transform.ts` (`539fef13a29882567463a58b1a72fd8d2c1602efccd3c4a7c42e5d5310e4c27f`)
- `packages/opencode/src/provider/error.ts` (`e2c87611d8cb331a509580dc0cea5d37a5d0677df1c9646d99cba03595eaf27b`)
- `packages/opencode/src/provider/model-status.ts` (`7e99e64d54d69505e3d8f46051adf56a991a63e32fd2ec4acac53fc197218f66`)
- `packages/core/src/models-dev.ts`

Imported on 2026-07-14. The local checkout did not expose a Git commit hash.

CodePilotX maps the upstream catalog into `@codepilotx/model-schema`, uses the
static `@codepilotx/provider-plugin` host, and exposes a Promise-based runtime.
Runtime npm installation, arbitrary package import, file plugin loading, and
OpenCode global services were intentionally omitted. OAuth refresh and provider
specific transports can only be added through statically supplied custom loaders
or extensions. The complete upstream bundled provider allowlist is retained.

Local implementation files: `src/runtime/ProviderRuntime.ts`, `src/runtime/index.ts`, `src/catalog.ts`,
`src/bundled.ts`, `src/custom.ts`, `src/variants.ts`, `src/security.ts`,
`src/error.ts`, and `src/types.ts`.

OpenCode is MIT licensed. See `LICENSE`.
