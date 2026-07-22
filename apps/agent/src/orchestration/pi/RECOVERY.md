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

One continuation limitation remains: after appending the recovered tool result,
the adapter currently sends a short continuation instruction through
`AgentHarness.prompt()` instead of invoking Pi's lower-level `Agent.continue()`
API directly. It never reinserts the original user request, and the idempotency
boundary still prevents side-effect replay.

Turn terminal state is finalized by `ThreadService` after the runtime returns;
it is not part of the Pi `save_point` transaction. Session entries, terminal
items, and their outbox events are atomic, while turn completion remains the
existing outer lifecycle transaction boundary.
