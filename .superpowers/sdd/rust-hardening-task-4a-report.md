# Task 4A implementation report

## Result

Implemented deterministic desktop sidecar lifecycle, fatal transport propagation,
stable runtime fallback, packaged executable resolution, and a single locked release
sidecar resource.

Commits:

- `a92dd00c8 feat(desktop)：修复侧车生命周期与传输恢复`
- `95ff563f5 feat(desktop)：传播侧车传输致命错误`
- `e816d5967 feat(desktop)：固定发布侧车打包产物`
- `e2ffc17b1 feat(desktop)：识别打包侧车资源路径`

## RED / GREEN evidence

- `auto` runtime RED: returned `RustSidecarDesktopAgentRuntime`; GREEN: returns
  `SidecarDesktopAgentRuntime` while `rust-sidecar` remains explicit opt-in.
- session disposal RED: returned before runtime cleanup and called no runtime
  disposer; GREEN: idempotent shared Promise and awaited runtime disposal.
- shutdown disposal RED: no aggregate helper and `before-quit` fire-and-forgot
  session cleanup; GREEN: shutdown awaits all session runtimes after persistence.
- failed terminal RED: emitted `error`, resolved, rejected, then emitted `done`;
  GREEN: one terminal gate, error rejects only, done/interrupted resolves only.
- child disposal RED: resolved before child `exit`; GREEN: kill is issued once and
  disposal awaits `exit`/`error`.
- startup retry RED: thread/start failure left state/child uncleared; GREEN:
  `stopped -> starting -> ready/failed`, failed attempt closes transport, kills and
  waits, and the next attempt spawns a fresh child.
- EPIPE RED: Writable callback error escaped and only a request-local rejection was
  available; GREEN: one fatal transport path rejects all pending requests, notifies
  the runtime, and cleans up the child without throwing from a callback.
- packaged resolver RED: accepted a repo target/env override; GREEN: packaged
  Electron resolves only `<resourcesPath>/desktop-rust-sidecar/<binary>`.
- packaging RED: prepare command lacked required release/lock/strip settings and the
  sidecar was duplicated through `files`/`asarUnpack`; GREEN: static packaging test
  proves one `extraResources` mapping and release + locked + strip configuration.

## Lifecycle design

The Rust runtime owns one startup Promise and one disposal Promise. Concurrent
startup callers share the startup attempt; concurrent disposal callers share the
cleanup. Failed initialization or thread start uses the same transport/child cleanup
path as fatal Writable errors. Child references are cleared only after exit, and old
child events cannot overwrite the state of a newer child. Each turn has a terminal
gate reset at turn start.

Session deletion/catalog cleanup already awaited `session.dispose()`; the session
now forwards that await into its runtime. Auto-review runtimes and application
shutdown use the same contract.

## Reused source

The stable non-Rust runtime was restored by reusing the existing
`apps/desktop/src/main/sidecarAgentRuntime.ts`. Git history at `c510a32fd^` identifies
this TypeScript app-server sidecar as the v1 default runtime; no replacement runtime
was invented.

## Validation

- Focused Bun suite: agent runtime/session, auto-review, session removal,
  Rust JSON-RPC, Rust runtime and startup lifecycle.
- `bun run desktop:typecheck`.
- `bun run desktop:css:check` (no CSS files changed).
- `bun test ./scripts/prepare-desktop-rust-sidecar.test.ts`.
- `cargo metadata --locked --no-deps --format-version 1 --config
  'profile.release.strip="symbols"'`.

## Limits

- A full Rust release build and Electron installer were not produced; the task brief
  permits static packaging verification and does not require a full installer.
- OS-level process enumeration was represented by deterministic fake child process
  counts and awaited exit tests; clean-VM installer/process validation remains a
  release acceptance step.
