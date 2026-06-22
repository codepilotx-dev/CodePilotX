# AGENTS.md

## Scope
Applies to long-lived service modules under `services/`.

## Conventions
- Services hold cross-cutting state, side-effecting I/O, or coordination logic
  that other subsystems reuse. Keep the public surface small and explicit.
- Do not import React or Ink here. Services must be usable from headless
  contexts, hooks, and components alike.
- Prefer dependency injection or factory functions over module-level
  singletons unless the existing pattern already requires a singleton.
- Keep network, filesystem, telemetry, and secret-handling boundaries inside
  the service that owns them. Do not leak raw handles to callers.
- Match the existing per-service file layout (for example, `notifier.ts`,
  `claudeAiLimitsHook.ts`, `mcpServerApproval.tsx`). Add new sibling modules
  rather than expanding unrelated ones.
- Preserve existing event/hook naming and emission cadence. Other modules rely
  on the current broadcast shape.

## Validation
- Search for all callers and consumers of a service before renaming, splitting,
  or changing its public exports.
- When changing any service that emits notifications, telemetry, or background
  work, trace downstream handlers and confirm the contract still holds.
