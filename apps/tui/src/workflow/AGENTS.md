# AGENTS.md

## Scope
Applies to the workflow runtime under `workflow/`.

## Conventions
- The workflow runtime turns SDK events into UI-visible state. Keep the
  mapping layer (`sdkEventMapping.ts`) and the runtime (`ThreadRuntime.ts`)
  responsibilities separate; do not fold SDK parsing into the runtime.
- Treat the runtime as the single source of truth for derived UI state.
  Components should read from it rather than recomputing projections.
- Preserve event ordering and idempotency. Reducer-style logic here must remain
  deterministic for a given event stream.
- Cross-platform path, filesystem, and shell concerns belong in `utils/`, not
  in the workflow runtime.
- When extending the runtime, update both the runtime and any matching event
  mapping in the same change.

## Validation
- For any reducer or mapping change, reason through replay, restart, and
  out-of-order event scenarios before landing the change.
- Confirm that the desktop projection (`apps/desktop/src/main/workflowProjection.ts`)
  still matches the runtime's emitted state shape when the contract shifts.
