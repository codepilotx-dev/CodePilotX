# Task 2 — Credential and GitHub security boundary report

Status: security-review fixes implemented; protocol/model-provider and desktop validation pass. App-server tests remain blocked by pre-existing `codepilotx-core` type-recursion errors.

## Commits

- `9100bcc35` — `feat(desktop)：收紧凭据与子进程环境边界`
- `b98da9afd` — `feat(rust)：迁移安全凭据并加固 GitHub 克隆`
- Review-fix commit: recorded after final commit.

No prior Task 1 commit was amended and nothing was pushed.

## Implemented

- Core provider credentials now fail closed when no credential adapter is present; `.credentials.json` is never created or updated as a fallback.
- Desktop provider-key save/read/delete uses Rust app-server RPC and providerID-scoped OS keyring entries.
- Legacy `providerApiKeys` and `provider-auth/*.json` secrets migrate to keyring storage. Plaintext fields/files are removed only after a successful secure write; retries are idempotent.
- Provider IDs are restricted to ASCII letters, digits, `-`, and `_`.
- Sidecar, provider-auth control sidecar, and Rust `process/spawn` inherit only a small launch environment; provider/auth/token/password variables are not inherited.
- Rust model providers resolve `keyring:<providerID>` directly through `codepilotx-keyring-store`; desktop no longer puts provider keys in environment variables or command arguments.
- GitHub clone validates HTTPS `github.com` repository URLs and normalized absolute destinations before git execution, uses `git clone --`, a temporary AskPass helper, `env_clear`, and cleanup of AskPass and partial clone output on failure.
- Keyring read/write/delete failures are returned as JSON-RPC errors rather than swallowed.
- Desktop model discovery and DeepSeek balance calls now execute in Rust through authenticated RPC; saved keys never return to Electron/JavaScript.
- Provider environment-variable fallback is rejected; only `keyring:<providerID>` secure storage is accepted.
- Clone destinations are constrained beneath the trusted app-server workspace root, cloned into a same-parent staging directory, and atomically published only after success.
- Clone subprocesses use isolated HOME/global/system Git config and redact token-shaped stderr. Failure and concurrent-target paths preserve caller data.
- Empty keyring entries no longer cause legacy plaintext removal before a successful replacement write; legacy token cleanup is retried after secure reads.
- Provider credential/model/balance protocol JSON and TypeScript artifacts are generated from Rust sources.
- Stored provider keys now resolve endpoints only from the server-side `Config.model_providers` map; caller-provided URLs are ignored unless the same request supplies a transient key, and every credential-bearing endpoint must use HTTPS.
- Clone publication uses atomic no-replace primitives: Windows rename without replace, Linux `renameat2(RENAME_NOREPLACE)`, and macOS `renamex_np(RENAME_EXCL)`. Unsupported Unix targets fail closed.
- Short-lived desktop auth sidecars inject validated HTTPS provider definitions from the Electron provider catalog using quoted Rust `-c` overrides; API keys never appear in arguments or environment variables.
- Git clone arguments and path-valued environment variables use `OsString`/`OsStr` end to end, preserving Unicode and non-UTF-8-capable platform paths without `to_string_lossy`.

## TDD evidence

RED observed before production changes:

- Missing core credential adapter returned `success: true` and created plaintext credentials instead of failing closed.
- Sidecar launch inherited `SENTINEL_PROVIDER_API_KEY` from `process.env`.
- Rust sidecar provider configuration still emitted the provider API key environment variable.
- Provider-auth control sidecar test initially failed because its options helper was not exported/sanitized.
- Desktop secure credential adapter test initially failed because no Rust credential service adapter existed.
- Rust keyring migration, traversal rejection, RPC error propagation, clone validation, and injected clone-failure cleanup tests were written before their implementations.

GREEN evidence:

```text
bun test packages/core/src/models/providerConfig.test.ts \
  apps/desktop/src/main/modelProviderService.test.ts \
  apps/desktop/src/main/rustAppServerAuthService.test.ts \
  apps/desktop/src/main/sidecarManager.test.ts \
  apps/desktop/src/main/rustSidecarRuntime.test.ts

62 pass, 0 fail, 168 assertions

bun run desktop:typecheck
PASS

rustfmt --edition 2024 <each touched Rust implementation/test file>
PASS (nightly-only imports_granularity warning only)

cargo metadata --locked --no-deps --format-version 1
PASS

cargo test -p codepilotx-model-provider-info provider_api_key --locked
3 pass, 0 fail (includes environment-fallback fail-closed coverage)

cargo test -p codepilotx-app-server-protocol --test schema_fixtures --locked -- --nocapture
2 pass, 0 fail

git diff --check
PASS
```

## Required reuse sources

- Clone URL, target, `--`, AskPass, and cleanup structure adapted from:
  `D:\VueProject\ClaudeCode-rust-foundation-hardening\apps\desktop\src\main\githubService.ts` lines 838–929.
- Keyring abstraction, mock store, and error propagation adapted from:
  `D:\GitHubProject\Agent\codex-main\codex-rs\keyring-store\src\lib.rs` and
  `D:\GitHubProject\Agent\codex-main\codex-rs\login\src\auth\storage_tests.rs`.
- `D:\GitHubProject\Agent\claude-code-master` was searched with `rg`; its Git environment patterns disable interactive prompts but did not provide providerID-scoped keyring storage, so no credential implementation was copied from it.

## Validation limitation

Using an explicit rsproxy sparse-index override resolved the workspace dependencies and allowed real protocol generation plus focused model-provider tests. The focused app-server test build still stops before reaching this task's tests because existing `codepilotx-core` code produces five `E0275` Send/type-recursion overflow errors. No recursion-limit workaround was added because that failure is outside Task 2 and would mask the repository baseline issue.

Before landing, rerun the app-server credential/clone tests after the `codepilotx-core` E0275 baseline is repaired.

The final stored-key-exfiltration, atomic no-clobber, and path-preservation app-server build reached Rust compilation after the package-cache lock cleared, then stopped at the same five pre-existing `codepilotx-core` `E0275` errors before compiling app-server tests. The new tests remain included for the next run after that baseline is repaired.

No CSS files were changed.
