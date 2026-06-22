# AGENTS.md

## Scope
Applies to the agent runtime core under `packages/core/src/agent/`.

## Conventions
- This package is consumed by the TUI, the desktop app, and external
  tooling. Treat its exports as a public API.
- Keep the runtime (`runtime.ts`), permissions (`permissions.ts`), and
  workflow (`workflow.ts`) modules focused. Do not fold runtime state
  into the workflow module or vice versa.
- Reuse the existing permission types and decision shapes. New permissions
  belong in `permissions.ts` and must match the TUI's permission
  classification.
- Be cross-platform. Path, shell, and filesystem assumptions in this
  package affect desktop, TUI, and headless callers.
- Avoid hidden side effects at module import. Use explicit init functions
  or factory entry points.

## Validation
- After changing any exported type or function, search consumers across
  `apps/tui`, `apps/desktop`, and any external integration before landing.
- For workflow or runtime changes, exercise both interactive and headless
  entry points and confirm the desktop projection still matches.
