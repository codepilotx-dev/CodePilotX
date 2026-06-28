# AGENTS.md

## Scope
Applies to React/Ink hooks under `hooks/`.

## Conventions
- Hook names follow the `useX` convention and live in their own files.
- Keep hooks focused on a single concern (input buffer, history, settings
  change, terminal size, etc.). Avoid hooks that mix unrelated responsibilities.
- Reuse the global keybinding system instead of subscribing to raw `useInput`
  for shortcuts. Components with embedded text input must allow parent
  dialogs or keybinding handlers to be disabled when the input is active.
- Treat returned values as stable references where possible. Memoize large
  derived values when consumers depend on identity equality.
- Do not perform side effects at module top level. Side effects belong inside
  the hook or behind explicit `useEffect` boundaries.
- When a hook reaches across IPC, services, or filesystem, document the
  expected ownership and cancellation rules near the hook.

## Validation
- For hooks that touch terminal dimensions, focus, or input, verify behavior
  across narrow terminals, focus loss, and remount scenarios.
- For hooks that subscribe to settings, services, or external state, confirm
  the cleanup path runs on unmount or settings change.
