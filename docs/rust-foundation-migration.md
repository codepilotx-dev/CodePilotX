# Rust Foundation Migration

## Boundary and rollout

The Electron desktop remains a client. Authentication, provider credentials,
GitHub operations and agent business logic belong to
`rust/codex-rs/app-server`. This is a staged migration, not a line-by-line
TypeScript rewrite.

`CODEPILOTX_DESKTOP_RUNTIME` accepts only:

- `auto` (default): the established TypeScript sidecar path.
- `rust-sidecar`: explicit opt-in to `codepilotx-app-server`.

An unsupported value is logged and treated as `auto`. Rust is not selected by
`auto` until the release gate and clean-VM acceptance suite are complete.

In development the resolver searches only this checkout's
`rust/codex-rs/target/debug`. A packaged app resolves exactly
`process.resourcesPath/desktop-rust-sidecar/codepilotx-app-server[.exe]` and
does not search developer build directories.

## Source provenance

- Upstream project URL: `https://github.com/openai/codex`.
- Local read-only reference: `D:\GitHubProject\Agent\codex-main\codex-rs`.
- Imported workspace in this repository: `rust/codex-rs`.
- Upstream commit/tree hash: unavailable from the supplied local reference.
  Evidence: neither `D:\GitHubProject\Agent\codex-main` nor its `codex-rs`
  child contains `.git`, so `git rev-parse HEAD` cannot be derived locally.

Do not invent a provenance hash. A future refresh must record the source URL,
commit and tree hash before copying the mirror.

## Security contract

Provider API keys and GitHub/Copilot tokens are keyed by `providerID` in the OS
keyring. The desktop injects a secure credential store and refuses plaintext
fallback. The Rust app-server migrates legacy `provider-auth/*.json` and
`providerApiKeys` from `.credentials.json` into the keyring, then removes the
legacy secret material; migration failures are returned to the caller.

Provider-key resolution never falls back to `provider.envVars`,
`apiKeyEnvVar`, or `process.env`. Secrets are not placed in sidecar or spawned
tool environments. A transient key may cross an authenticated in-memory RPC
request only for the operation that supplied it.

The loopback HTTP server exposes:

- `GET /healthz`: the only unauthenticated route.
- `POST /jsonrpc`: requires `X-Auth-Token` and enforces a 1 MiB body limit by
  default (`413` on overflow).
- `GET /events`: requires the same token and returns an SSE fetch stream.

Browser requests must use an exact configured Origin; wildcard CORS and
loopback authentication bypasses are forbidden. The SSE contract uses
`fetch()` with `X-Auth-Token` and reads `response.body`; native `EventSource`
cannot attach the required header.

## Sidecar lifecycle and streaming

Startup follows `stopped -> starting -> ready -> failed`. Failure during spawn,
`initialize`, or `thread/start` closes the transport, kills the child and waits
for exit. The next turn starts a fresh process. Transport write errors travel
through the fatal async handler and reject every pending JSON-RPC request.

`dispose(): Promise<void>` is idempotent. Session deletion and application
shutdown await it. Each turn has one terminal outcome: `failed` rejects;
`completed` and `interrupted` resolve. A later notification cannot replace a
sealed terminal outcome.

Streaming stores delta chunks and emits incremental updates on a 40 ms
schedule. Only the final assistant message is written to history. Persistence
keeps failed batches for bounded retry, and `flush()` returns failure instead
of claiming success. The UI exposes the resulting unsaved-session state.

## Packaging contract

`bun run desktop:rust-sidecar:prepare` is release-only. It runs Cargo with
`--release --locked` and `profile.release.strip="symbols"`, then copies one
binary to `dist/desktop-rust-sidecar`. Electron-builder has exactly one
`extraResources` entry mapping that directory to `desktop-rust-sidecar`.

`bun run desktop:dist:unpacked:win` produces the unpacked acceptance artifact.
CI verifies that its resolver directory contains exactly one
`codepilotx-app-server.exe` before uploading it.

## Schema and validation

Rust protocol types are the source of truth. From the repository root:

```powershell
bun install --frozen-lockfile
bun run ci:validate
bun run test
bun run desktop:typecheck
bun run desktop:css:check

cd rust/codex-rs
cargo metadata --locked --no-deps --format-version 1
cargo fmt --all -- --check
cargo check -p codepilotx-app-server-protocol --locked
cargo test -p codepilotx-app-server --test all --no-run --locked
cargo test -p codepilotx-app-server-protocol --test schema_fixtures --locked -- --nocapture
cargo run -p codepilotx-app-server-protocol --bin write_schema_fixtures --locked -- --schema-root app-server-protocol/schema
git diff --exit-code -- app-server-protocol/schema
```

The current branch has previously reached five pre-existing `codepilotx-core`
E0275 Send/type-recursion overflow errors while compiling the full app-server
test target. The latest local retry could not re-confirm them because the
configured Tsinghua crates.io mirror returned HTTP 404 while fetching
`aws-config`. CI keeps the full no-run target visible; do not mask the issue by
raising recursion limits.

## Debugging and integration workflow

Use `git log -- <path>`, `git log -S '<literal>'` and
`git log -G '<regex>'` before bisecting. Mechanical renames are inspected with
`git show -w --find-renames <sha>`. Bisect runners must return 125 (or run
`git bisect skip`) for known non-buildable transition commits `0efce3a85` and
`b6d63bce2`.

Do not rewrite the migration branch. The clean integration branch preserves
logical batches for: Rust mirror provenance, buildable Rust baseline, protocol
adaptation, credential/GitHub security, HTTP security, runtime/lifecycle,
persistence/streaming, and packaging/CI/documentation. Merge or cherry-pick
those batches in order so each security boundary remains reviewable.
