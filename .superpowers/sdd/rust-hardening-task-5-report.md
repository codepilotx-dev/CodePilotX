# Task 5 report — CI, Rust baseline, schema and migration docs

Status: review fixes and F-drive acceptance completed locally. No history was
rewritten and nothing was pushed.

## Delivered

- Test discovery covers every tracked `*.test.ts` and `*.test.tsx` outside
  generated, vendored, fixture, target and dependency artifact trees.
- The runner uses stable modulo shards, four isolated child processes per
  shard, a 120-second hard file watchdog, Windows `taskkill /PID ... /T /F`
  or Unix process-group `SIGKILL`, and reports all failures after the pool
  drains.
- CI separates static/typecheck/CSS, four test shards, Rust/schema, and Windows
  package jobs. Every job has a timeout. Official actions use checkout v7,
  setup-node v6, upload-artifact v7, and setup-bun v2.
- The workflow validator inspects parsed YAML jobs, steps, working directories
  and command argv. It verifies the test matrix, checkout depth, schema
  fixture/generator/clean-diff scope, release arguments, and recursive sidecar
  uniqueness.
- Push whitespace checks treat an empty or all-zero `before` SHA and an
  unreachable commit as `HEAD^`. The tracked Git pathspec was exercised in a
  real temporary repository containing a path with spaces.
- Blanket vendor and source-file whitespace exclusions were removed. The only
  source hard-break fixture now constructs its two spaces at runtime, and the
  bubblewrap license whitespace was cleaned.
- Rust migration damage was repaired from
  `D:\GitHubProject\Agent\codex-main\codex-rs`: 471 same-line Unicode losses in
  121 files, additional malformed multi-line TUI fixtures, and six files whose
  module declarations had migrated to `codepilotx_*` while the files retained
  their old names. No new test logic was invented for those renames.
- The five E0275 failures were reproduced on Rust 1.95 and 1.97. They are the
  same finite reqwest 0.13 Hyper/Tower `Send` chain, so `codepilotx-core` uses
  rustc's suggested recursion limit of 256.
- App-server compile drift was closed by re-exporting the provider processor,
  promoting reqwest from a dev dependency, reusing the existing error-code
  helpers, cloning device-flow value state, and making an existing `UserInput`
  match exhaustive.
- Sidecar release args have one shared structured source and require
  `--release`, `--locked`, symbol stripping, and `profile.release.lto=false`.
  The LTO override was added after the default thin-LTO link reached roughly
  14.7 GB working set and 20 GB private memory, which is unsuitable for a
  GitHub Windows packaging runner.
- `file://` navigation now has an explicit security regression assertion.

## Validation evidence

```text
cargo fmt --all -- --check
  exit 0; no parse/module errors or diffs

cargo check -p codepilotx-core --locked
  exit 0; 55.7s

cargo check -p codepilotx-app-server --lib --locked
  exit 0; 87.5s

cargo test -p codepilotx-app-server --test all --no-run --locked
  exit 0; 73.8s; test executable produced

cargo test -p codepilotx-app-server-protocol --test schema_fixtures --locked
  2 passed, 0 failed

cargo run -p codepilotx-app-server-protocol --bin write_schema_fixtures --locked -- --schema-root app-server-protocol/schema
git diff --exit-code -- app-server-protocol/schema
  exit 0; generated schema clean

bun test scripts/ci-contract.test.ts apps/desktop/src/main/browserService.test.ts
  19 passed, 0 failed

bun test scripts/prepare-desktop-rust-sidecar.test.ts scripts/ci-contract.test.ts
  12 passed, 0 failed

bun run ci:validate
  structured workflow, paths, commands and sidecar contract valid

bun install --frozen-lockfile
  exit 0; 1,292 packages installed in the F-drive worktree

bun run desktop:typecheck
  exit 0

bun run desktop:css:check
  exit 0; 0 same-file, 0 cross-file, 0 scoped-target overlaps

node scripts/prepare-desktop-rust-sidecar.mjs --release <source-only Cargo overrides>
  exit 0; 21m 03s cold-cache release build after dependency compilation
  release and dist binaries: 269,078,016 bytes
  SHA-256: 8C3B0A90591EAA992375AC63EF1BE42C2F8CEF6872D7B1DC96EA041D10267806

node scripts/ci-contract.mjs verify-sidecar
  exactly one runnable codepilotx-app-server.exe at the packaged resolver path

cargo test -p codepilotx-app-server --test all --no-run --release --locked
  exit 0; test executable produced

node scripts/ci-contract.mjs whitespace origin/main
  exit 0
```

The user-level Cargo config points at an obsolete Tsinghua Git index. Local
locked Cargo verification therefore supplied an explicit rsproxy sparse-index
override; CI uses crates.io normally.

## Release and full-run note

Final acceptance ran in
`F:\CodeProject\CodePilotX-worktrees\rust-foundation-hardening`. The cold-cache
release build used the shared no-LTO, locked and stripped contract. Its final
linker peaked around 6 GB working set, well below the roughly 14.7 GB observed
with the former thin-LTO default. The copied distribution binary is byte-for-byte
identical to the release output and its `--help` command runs successfully.

The packaging helper accepts repeatable, source-only `--cargo-config`
arguments so local validation can bypass the obsolete user-level Tsinghua
index. Profile and other arbitrary Cargo overrides are rejected; CI uses the
default crates.io registry.

The locked v8 dependency is `149.2.0`. Because its upstream archive download was
too slow during the F-drive cold build, acceptance reused one previously
validated Windows `rusty_v8.lib` cache artifact for the exact same version via
the process-local `RUSTY_V8_ARCHIVE` variable. The temporary absolute path is
not present in repository files or commits.

The full 150-file Bun runner had already passed before the worktree migration.
On F, the Task 5 focused set (20 tests), CI contract, desktop typecheck, CSS
ownership, Rust formatting, app-server no-run, schema fixtures and schema
clean-diff all passed. No second broad test run was started after release
acceptance, avoiding unnecessary disk growth before the requested cleanup.

## Reference provenance

- Reference URL: `https://github.com/openai/codex`.
- Local source: `D:\GitHubProject\Agent\codex-main\codex-rs`.
- The local reference does not contain Git metadata, so no commit/tree hash was
  invented.

## Commits

- `7dccc0ecd feat(desktop)：建立全量测试发现与持续集成门禁`
- `fde282e82 docs(desktop)：统一迁移契约与源码空白门禁`
- `ba39ad779 docs(desktop)：记录持续集成与迁移验证结果`
- `14a5be4bc docs(desktop)：清理持续集成报告空白`
- `06d4c3a02 fix(rust)：恢复迁移源码并建立可解析基线`
- `ef20ac943 fix(rust)：补齐应用服务认证接口编译契约`
- `adb0ac1cf style(rust)：统一迁移工作区格式`
- `933747399 fix(ci)：强化测试分片与发布门禁`
- `c987dafb7 style(rust)：清理第三方许可空白`
- `cbb6902ab fix(ci)：降低发布构建内存占用`
