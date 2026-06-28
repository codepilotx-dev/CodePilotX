# AGENTS.md

## Scope
Applies to headless (non-interactive) execution under `headless/`.

## Conventions
- Headless mode runs without a TTY and must not pull in React/Ink rendering,
  raw `useInput` handlers, or terminal-only keybindings.
- Use the existing event handlers, transports, and structured I/O helpers in
  this directory rather than building parallel paths.
- Keep all output machine-readable. Avoid raw ANSI control sequences or
  color codes in headless paths.
- Respect the same permission, sandbox, and tool rules as interactive mode.
  Headless must not bypass safety checks to simplify output.
- Match the existing NDJSON and JSON-RPC event shapes; downstream tools and
  remote clients depend on them.

## Validation
- Verify both streaming and one-shot headless invocations after any handler
  or transport change.
- Confirm error paths still emit structured events and that exit codes match
  the documented behavior.
