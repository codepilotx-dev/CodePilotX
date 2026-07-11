# Task 5 report — CI, discovery, schema and migration docs

Status: implemented with two active CI commits plus this report. No history was
rewritten and nothing was pushed.

## Delivered

- Replaced the 26-file root test list with tracked-file discovery from
  `git ls-files -z`. It selects every `*.test.ts`/`*.test.tsx` and excludes only
  generated, vendored, fixture, Rust target and dependency artifact segments.
- Runs each dynamically discovered test file in an isolated Bun process with a
  30-second test timeout. This avoids cross-file global-state collisions and
  gives the failing file directly instead of leaving one shared process hung.
- Added `.github/workflows/ci.yml` with three Windows jobs:
  - TypeScript/repository: frozen install, CI contract, all Bun tests, desktop
    typecheck, CSS ownership and base-relative whitespace.
  - Rust/schema: locked metadata, rustfmt, protocol check, app-server focused
    no-run compile, schema fixture, real generator and generated clean diff.
  - Package: release unpacked Windows desktop build, exact sidecar-resource
    verification and artifact upload.
- Added executable static validators for workflow commands/paths, test
  discovery, sidecar resource uniqueness/resolver agreement and the narrow
  whitespace exclusion set.
- Added `desktop:dist:unpacked:win`; the existing sidecar preparation remains
  release-only, locked and stripped.
- Rewrote the Rust migration contract and corrected the protocol map for
  keyring-only credentials, authenticated HTTP/SSE, stable `auto`, explicit
  Rust opt-in, lifecycle, packaging, schema and bisect behavior.
- Removed real source/documentation whitespace failures. Exclusions are limited
  to snapshot trees, TUI frame assets, generated schema, explicit patch/test
  fixtures, skill/vendor assets, and two exact files containing intentional
  whitespace fixtures/ASCII frames.

## Validation evidence

### Green

```text
bun test scripts/ci-contract.test.ts
  6 pass, 0 fail

bun run test
  150/150 tracked test files passed
  elapsed: 177.4s on this Windows checkout

bun run desktop:typecheck
  exit 0

bun run desktop:css:check
  0 same-file, 0 cross-file, 0 scoped-target overlaps

bun run ci:validate
  workflow commands, paths and sidecar resource agree

node scripts/ci-contract.mjs whitespace origin/main
  exit 0

cargo metadata --locked --no-deps --format-version 1
  exit 0
```

The local Cargo configuration replaces crates.io with the obsolete Tsinghua
Git index, which returned HTTP 404. With an explicit rsproxy sparse-index
override, the real schema gates passed:

```text
cargo test -p codepilotx-app-server-protocol --test schema_fixtures --locked -- --nocapture
  2 passed, 0 failed

cargo run -p codepilotx-app-server-protocol --bin write_schema_fixtures --locked -- --schema-root app-server-protocol/schema
git diff --exit-code -- app-server-protocol/schema
  exit 0; no generated content changes
```

### Known blockers / not claimed

- `cargo fmt --all -- --check` is an active CI gate but is not green in this
  imported mirror. It reports broad pre-existing formatting drift and parse
  errors in malformed imported files such as
  `tui/src/bottom_pane/app_link_view.rs`,
  `utils/output-truncation/src/truncate_tests.rs`, and
  `utils/path-uri/src/api_path_string_tests.rs`. Task 5 did not mass-format or
  repair unrelated mirror artifacts.
- Previous focused app-server compiles reached five pre-existing
  `codepilotx-core` E0275 Send/type-recursion errors. The latest plain Cargo
  retry stopped earlier at the local Tuna mirror HTTP 404. The CI no-run target
  intentionally remains visible and no recursion-limit workaround was added.
- A full release sidecar build and Electron unpacked package were not repeated
  locally. The workflow executes the real `desktop:dist:unpacked:win` pipeline,
  verifies exactly one resolver-path binary, and uploads the unpacked artifact.

## Reference provenance

- URL identified by the supplied reference README:
  `https://github.com/openai/codex`.
- Local reference path: `D:\GitHubProject\Agent\codex-main\codex-rs`.
- Neither the reference root nor `codex-rs` contains `.git`; therefore an
  upstream commit/tree hash is unavailable from local evidence. No hash was
  invented.

## Commits

- `7dccc0ecd feat(desktop)：建立全量测试发现与持续集成门禁`
- `fde282e82 docs(desktop)：统一迁移契约与源码空白门禁`
