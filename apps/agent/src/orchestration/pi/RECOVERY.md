# Pi recovery boundary

The Pi main path now keeps recovery ownership in the existing Agent services:

- `save_point` flushes buffered Pi session entries, terminal items, and their
  durable outbox rows in one `AgentDatabase` transaction; EventHub publication
  happens only after commit.
- Question, permission, and subagent waits persist a checkpoint containing the
  stable Pi `toolCallID` and return a paused runtime result.
- Restart recovery finds the original assistant tool call, moves the session
  leaf to that entry, appends the matching Pi tool-result message, and uses the
  persistence-backed `ToolExecutor` result when the call already succeeded.
- A completed `toolCallID` is the idempotency key, so approval recovery cannot
  repeat a successful side effect.
- Turn start and terminal transitions update the Turn, root Agent, pending
  items, queue state, and durable outbox rows in one outer lifecycle
  transaction. Startup recovery emits the same durable projection events.
- A claimed question, denied approval, or already-completed tool result can be
  queued again after restart. A claimed tool that was still running or errored
  is interrupted fail-closed because its host-side effect is observationally
  ambiguous.

One continuation limitation remains: after appending the recovered tool result,
the adapter currently sends a short continuation instruction through
`AgentHarness.prompt()` instead of invoking Pi's lower-level `Agent.continue()`
API directly. It never reinserts the original user request, and the idempotency
boundary still prevents side-effect replay.

Turn terminal state is finalized by `ThreadService` after the runtime returns;
it is not part of the Pi `save_point` transaction. It uses a separate atomic
outer lifecycle transaction, so a crash cannot commit the terminal projection
without its durable events.
