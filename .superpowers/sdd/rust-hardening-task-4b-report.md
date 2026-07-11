# Task 4B report — rollout persistence and streaming performance

## Commits

- `5c4411015 feat(desktop)：保证会话持久化失败可恢复`
- `7986a9bd4 feat(desktop)：优化流式消息聚合与渲染`
- `8cc07e80b feat(desktop)：修复并发持久化与退出失败处理`
- `bcce651ef feat(desktop)：封闭流式终态并保持线性更新`
- `9948aa399 feat(desktop)：加固会话持久化锁与崩溃恢复`
- `838ca4587 feat(desktop)：收敛流式缓冲与终态保护`
- `e1bef6cb5 feat(desktop)：强化持久化锁所有权与恢复证据`
- `7e9bc8bcf feat(desktop)：清理流式终态并隔离会话代际`
- `e19ec3c68 feat(desktop)：串行化持久化锁心跳与释放`
- `324e4cb84 test(desktop)：覆盖双源持久化状态恢复链路`
- `72700b691 feat(desktop)：按回合隔离流式消息代际`
- `29566b81a feat(desktop)：在心跳失败后安全释放持久化锁`

## Persistence RED / GREEN

RED was observed before production changes:

- ENOSPC, EACCES, ENOTDIR and generic EIO/rename failures all made the old
  rollout `flush()` resolve successfully; six new failure/recovery tests failed.
- The old session-store scheduler also resolved `flush()` after ENOSPC.
- The old UI had no persistence status helper or snapshot state.
- Append-after-error fault injection showed the old path could not prove retry
  idempotence.

GREEN behavior:

- A rollout batch stays at the queue head until its durable append succeeds.
  New items append behind it and are never reordered.
- Default bounded policy is three total attempts: initial write, then 50 ms and
  150 ms backoff retries. Tests inject zero-delay policies.
- `flush()` rejects with the original persistence error after retries are
  exhausted. A later append or `flush()` retries the retained ordered batch.
- Concurrent flush callers share the same per-path in-flight drain. Items
  appended during a drain are included before that drain resolves.
- Rollout writes use `O_APPEND`, call `sync()`, and preserve existing file
  mode/ACLs. An atomic companion lock directory serializes independent desktop
  schedulers; a durable companion recovery journal records the original offset,
  byte length and hash before append. It recognizes a completed unknown append
  result or truncates a partial tail before replay. JSONL records contain only
  the protocol's `timestamp`, `type`, and `payload` fields.
- Session-store saves retain the latest pending state, reject `flush()` on
  failure, and clear the error only after a successful retry.

## Failure-state UX

Rollout and session-store schedulers publish `saved | unsaved`. Main-process
session state combines both sources and sends the existing session-store change
notification; no IPC channel was added. The conversation title displays
`会话未保存` while either source is unsaved and removes it only after all failed
writes recover. Styling extends the owning `.chat-session-title` block and uses
existing warning/typography tokens.

## Streaming RED / GREEN and stress metrics

RED was observed before production changes:

- 10,000 deltas had no chunk buffer and emitted 10,000 cumulative partials.
- A partial agent event mutated the main durable snapshot and appended an
  `assistant_delta` history event.
- Renderer workflow history retained its 100-entry cap of cumulative partials
  instead of one transient item.

GREEN implementation:

- Assistant deltas use one mutable chunk array. Each input performs only
  `chunks.push(delta)`; cumulative text is materialized only on a throttled
  update or final completion.
- The first partial is immediate; subsequent updates use one 40 ms timer.
- Final completion materializes once, emits the final assistant message, then
  cancels the timer and clears chunks/buffer. New-turn, turn-terminal and error
  paths perform the same cleanup. Invoking a stale scheduled callback after
  final emits nothing.
- Main durable agent/workflow snapshots ignore streaming partials. Only the
  completed assistant message is persisted.
- Renderer agent and workflow state upsert one transient assistant item per
  turn. Final completion replaces it, and a late partial after final is ignored.

Measured by the deterministic stress tests on this checkout:

- Input: 10,000 deltas x 20 characters = 200,000 retained characters.
- Adapter storage: 10,000 fixed delta chunks; no cumulative-string copies per
  input delta.
- Adapter partial updates before final: 1; pending timers: 1.
- Durable partial history entries: 0; final assistant history entries: 1.
- Renderer transient workflow entries after 10,000 updates: 1.
- Follow-up time-spread tests cover 250 timer ticks and 200,000 characters in
  both adapter and renderer chunk storage.

## Validation

- Targeted Task 4B suites pass; root verification below covers the integrated
  paths.
- Root `bun run test`: 199 passed, 0 failed, 498 assertions.
- `bun run desktop:typecheck`: exit 0.
- `bun run desktop:css:check`: exit 0, zero overlaps.
- `git diff --check`: exit 0 for Task 4B changes.

## Reference reuse

The retry policy reuses the existing bounded scheduler pattern. Rollout storage
uses append ownership instead of the session-index atomic replacement helper,
because JSONL has independent appenders while the index has a single owner.

## Review follow-up

- Replaced full-file rollout replacement with durable `O_APPEND`. Desktop and
  Rust app-server rollouts have distinct owners/paths; the one desktop bypass
  (session metadata) now also uses the scheduler.
- Each scheduler batch has a stable id stored only in the companion journal.
  Recovery validates the exact appended tail by length and SHA-256; incomplete
  tails are truncated to the journal's original byte offset. Existing files
  without a trailing newline receive a separator. Two independent schedulers
  writing 12 x 64 KiB records each retain 24 valid, contiguous JSONL records.
  Stale locks are reclaimed after the bounded threshold and lock cleanup runs
  on both success and injected failure.
- Shutdown now rejects and keeps Electron running when either flush fails. Its
  singleton promise resets so the next quit request retries. Session deletion
  flushes first and leaves server/index/runtime/local state intact on failure.
- Persistence status is removed from every durable legacy snapshot boundary;
  it remains an IPC-only session-list state and reload defaults to no warning.
- Assistant streaming is closed by item id and terminal turn state. Timers bind
  generation + item id; stale callbacks and late deltas emit nothing.
- Time-spread adapter processing joins only new chunks. 10,000 x 20 characters
  over 250 timer ticks processes exactly 200,000 characters. Reasoning and
  summary streams now share the same 40 ms state-owned buffering policy;
  generation checks and terminal cleanup suppress stale callbacks and late
  deltas.
- Renderer transient state is owned by each session view rather than module
  globals. `StreamingText` maintains one DOM `Text` node and calls `appendData`
  only for unprocessed chunks. Its 10,000-chunk stress retains exactly 200,000
  characters with no cumulative text copies.
- Workflow transient identity uses stream/item identity, preserving
  assistant-1 -> tool -> assistant-2 ordering within one turn.

Fresh follow-up validation: root `bun run test` passed 200 tests / 501
assertions; desktop typecheck, CSS ownership check and branch diff check all
exited zero.

Second-review fresh validation: Task 4B's six integrated suites passed 127 tests
/ 358 assertions, including persistence status, durable-history exclusion,
adapter throttling, renderer streaming, and UI status. Root `bun run test`
again passed 200 tests / 501 assertions. Desktop typecheck, CSS ownership and
`git diff --check` exited zero. A separate unscoped `bun test` auto-discovery
probe exceeded the 124-second command limit without reporting an assertion
failure; it is not used as the repository's configured test gate.

## Third-review ownership and terminal hardening

- Lock publication now starts in a unique claim directory. Its strict
  `owner.json` contains a random token, PID, and heartbeat; both owner data and
  the parent directory are synced before/after atomic publication. The active
  owner refreshes heartbeat and directory mtime until release.
- Reclaim requires both a stale heartbeat and an explicitly dead PID. It moves
  the fixed lock to a unique claim path and revalidates token, heartbeat, and
  PID before deletion. Release uses the same unique-rename/token-revalidation
  pattern, so an old owner cannot remove a replacement owner's lock.
- Journal records are strict, path-bound `prepared | committed` receipts with
  non-empty batch/token, safe byte offsets, canonical base64 payload, exact
  length, and SHA-256. Writes use temp-file sync, atomic rename, and parent
  directory sync. Rollout append/truncate sync the data file; directory entry
  changes are synced where Node supports it. Windows directory-sync capability
  errors are explicitly allowlisted rather than treated as proof of support.
- Recovery truncates only a tail proven to be a strict prefix of the journal's
  exact payload. An exact full prefix is committed while later bytes are
  preserved. Invalid journals, shorter files, and unrelated/mixed tails fail
  closed with journal and rollout evidence unchanged. A committed receipt is
  retained until the next different batch, preventing duplicate retry if lock
  release fails after data commit.
- Renderer `done` and `error` remove all assistant/reasoning transient events,
  streaming messages, and chunk arrays. Active stream IDs are closed for the
  terminal generation; late deltas are ignored. The first subsequent running
  generation clears the bounded ID set. Delete/recreate reload starts from an
  empty generation.

Third-review RED was reproduced as 16 passing / 2 failing rollout tests: the
old ownerless mtime reclaim and incomplete journal fixture were rejected by the
new fail-closed rules. GREEN rollout coverage reached 24 tests and the lock
race suite was repeated five times without failure. Seven integrated Task 4B
suites passed 152 tests / 448 assertions. Post-commit root `bun run test` passed
200 tests / 501 assertions; desktop typecheck, CSS ownership, and
`git diff --check` all exited zero.

## Fourth-review serialization and integration hardening

- Heartbeats now use a recursive serialized scheduler: the next refresh is
  scheduled only after the prior refresh settles. Release stops the generation,
  cancels the pending callback, and awaits every started refresh. A heartbeat
  error marks the lock compromised, propagates to the writer, and deliberately
  leaves ownership fail-closed rather than silently removing the lock.
- Live-owner release no longer renames the fixed lock and creates an acquisition
  gap. It reads and verifies the token at the fixed path, treats mismatch as a
  no-op, and directly removes only its own live lock. Dead-owner reclaim remains
  isolated behind an atomic unique claim; it never restores over or touches a
  newly acquired fixed lock.
- If lock publication succeeds but parent-directory sync fails, acquisition
  performs token-qualified cleanup of the published lock. Durable temp files
  are removed after injected write, sync, and pre-rename failures. Startup
  cleanup only removes stale directories matching this protocol's acquire
  prefix. Directory-sync capability handling distinguishes open from sync and
  never suppresses `EACCES` or non-Windows `EPERM`.
- Recovery journals now bind the original rollout prefix SHA-256 in addition to
  the expected append payload. Replacing the prefix with same-sized bytes fails
  closed before tail recovery; a zero-size prefix uses the standard empty
  SHA-256.
- Rust adapter assistant/reasoning partials and final messages carry `turnId`
  metadata. Renderer stream generations reset when a different turn arrives,
  even if no intermediate `status: running` notification is observed.
- A combined integration test drives the real rollout and session-store
  scheduler callbacks into lightweight snapshot emission and the renderer's
  warning label. Failure of both sources shows `会话未保存`; recovering only one
  source retains it; recovering both clears it; delete/reload begins clear.

Fourth-review fresh validation: eight Task 4B suites passed 160 tests / 478
assertions. Root `bun run test` passed 200 tests / 501 assertions. Desktop
typecheck, CSS ownership, and `git diff --check` all exited zero.

## Final critical heartbeat recovery

Heartbeat compromise still makes the active write and `flush()` fail honestly,
but release now always attempts token-qualified lock removal after stopping the
generation and awaiting the in-flight refresh. A heartbeat error is propagated
after successful release; simultaneous heartbeat and release failures are
reported together with `AggregateError`. The retained committed journal lets
the scheduler retry the same batch without duplication.

Final focused validation passed 32 rollout tests / 108 assertions. The fault
injection proves: heartbeat `EIO` makes the first `flush()` reject, the owned
lock is gone, the second `flush()` succeeds, and the batch appears exactly once.
Desktop typecheck, CSS ownership, and `git diff --check` all exited zero.
