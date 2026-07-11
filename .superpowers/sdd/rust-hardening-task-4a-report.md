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
- `07cf8ebcf feat(desktop)：验证侧车进程回收基线`
- `2a89fa065 fix(desktop)：统一运行时终态与传输隔离`
- `c82c56b04 fix(desktop)：确保关机与侧车进程可靠回收`
- `b624e310a fix(desktop)：仅按退出事件确认侧车回收`
- `00c0ae2a6 fix(desktop)：封闭侧车错误终态与关机重入`
- `fde6ba420 fix(desktop)：保证侧车清理失败仍执行强制回收`
- `14395daee fix(desktop)：消除侧车双拒绝与强杀异常竞态`

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

## Review fixes

- Runtime is the sole owner of turn terminal events. Session integration tests
  prove successful and failed turns each expose exactly one terminal event.
- Rust terminal state is bound to the active turn id. Interrupt seals that turn,
  and delayed completion from an old turn cannot complete a newer turn.
- Desktop shutdown is one shared Promise. Rollout flush, session-store flush and
  session disposal failures are logged independently; `app.quit()` remains in a
  finalizer and reentrant `before-quit` does not launch another shutdown chain.
- TypeScript and Rust sidecars share confirmed process termination semantics:
  graceful kill, bounded wait for `exit`/`close`, then targeted Windows
  `taskkill /pid <child.pid> /t /f` (or `SIGKILL` elsewhere), followed by another
  bounded exit wait. Process `error` is not treated as exit, and kill failures are
  propagated without clearing the child reference.
- Rust fatal transport handling synchronously invalidates initialization/thread
  state and shares one cleanup Promise. Fatal listeners are isolated, and the
  Writable error handler is removed on close/fatal completion.
- Final focused validation after review fixes: 114 tests passed, 0 failed, with
  258 assertions; desktop typecheck and CSS ownership checks also passed.

## Second review fixes

- The Rust per-turn terminal gate now encloses executable resolution, spawn,
  initialize, thread start/resume, provider fork, turn start and transport
  rejection. Startup failure and direct turn-request rejection each emit exactly
  one error before rethrowing, and the session status leaves `running`.
- `before-quit` uses an independent `shutdownComplete` flag. Every reentrant event
  is prevented while cleanup is active; the internal finalizer sets completion
  immediately before calling `app.quit()`, so only that reentrant quit is allowed.
- Sidecar manager cleanup collects connection/listener errors but always attempts
  target process termination. One error is preserved; multiple cleanup and
  termination errors are returned as an `AggregateError`.
- A graceful `child.kill()` exception still proceeds to targeted force kill. The
  original error is propagated after confirmed target exit, or combined with the
  force-kill/timeout error when both paths fail.
- The Windows `taskkill` helper has its own timeout. On timeout it removes its
  listeners, kills the helper process, and rejects instead of hanging shutdown.
- Final focused validation after the second review: 118 tests passed, 0 failed,
  with 275 assertions; desktop typecheck and CSS ownership checks passed.

## Third review fixes

- Rust turn completion promises install an observation handler immediately.
  When an EPIPE rejects both `turn/start` and the completion gate in the same
  tick, the original completion promise remains awaitable without producing an
  unhandled rejection. A process-level probe verifies one terminal error and no
  `unhandledRejection` events.
- Writable callback failures retain a one-shot error isolation listener because
  fatal cleanup can synchronously remove the normal output handler before Node
  emits the scheduled stream error.
- A timed-out `taskkill` helper transitions to a post-kill isolation lifecycle.
  Its asynchronous error/exit/close is consumed once, listeners are removed, and
  a bounded safety cleanup prevents leaks when the helper stays silent. A
  process-level `uncaughtException` probe verifies no escaped post-timeout error.
- Third-review focused validation: 69 tests passed, 0 failed, with 168
  assertions; desktop typecheck, CSS ownership and diff checks passed.
