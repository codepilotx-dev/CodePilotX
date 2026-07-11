# Task 4B report — rollout persistence and streaming performance

## Commits

- `5c4411015 feat(desktop)：保证会话持久化失败可恢复`
- `7986a9bd4 feat(desktop)：优化流式消息聚合与渲染`
- `8cc07e80b feat(desktop)：修复并发持久化与退出失败处理`
- `bcce651ef feat(desktop)：封闭流式终态并保持线性更新`

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
  mode/ACLs. Stable batch ids and per-line indices make an unknown append result
  retry idempotent; recovery tests verify each completed item appears once.
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
- Each scheduler batch has a stable id plus line index/size metadata. A retry
  scans complete indices and appends only missing records. Blank/corrupt lines
  are ignored by the real loader; a partial tail recovery test returns each
  completed message once. Existing files without a trailing newline receive a
  separator. Two independent schedulers plus an external append retain all
  records without replacing mode/ACL state.
- Shutdown now rejects and keeps Electron running when either flush fails. Its
  singleton promise resets so the next quit request retries. Session deletion
  flushes first and leaves server/index/runtime/local state intact on failure.
- Persistence status is removed from every durable legacy snapshot boundary;
  it remains an IPC-only session-list state and reload defaults to no warning.
- Assistant streaming is closed by item id and terminal turn state. Timers bind
  generation + item id; stale callbacks and late deltas emit nothing.
- Time-spread adapter processing joins only new chunks. 10,000 x 20 characters
  over 250 timer ticks processes exactly 200,000 characters. Reasoning and
  summary streams also emit delta chunks and stop at turn terminal state.
- Renderer transient state retains fixed delta chunks, renders them as fragments
  while streaming, and joins only the final completed text. Its 10,000-chunk
  stress retains exactly 200,000 characters with no cumulative text copies.
- Workflow transient identity uses stream/item identity, preserving
  assistant-1 -> tool -> assistant-2 ordering within one turn.

Fresh follow-up validation: root `bun run test` passed 200 tests / 501
assertions; desktop typecheck, CSS ownership check and branch diff check all
exited zero.
