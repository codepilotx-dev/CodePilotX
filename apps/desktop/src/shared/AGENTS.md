# AGENTS.md

## Scope
Applies to code shared between main, preload, and renderer under
`apps/desktop/src/shared/`.

## Conventions
- This directory is the contract between privileged and unprivileged
  contexts. Treat its exports as a public API.
- IPC channel names live in `ipcChannels.ts`. Renderer-facing types live in
  `types.ts` and `desktopApiSchema.ts`. Update them together when adding
  channels or methods.
- Reuse `workflowReducer.ts`, `sessionEventModel.ts`, and the settings
  schema modules. Do not duplicate the desktop workflow state machine.
- Do not import from `main/`, `preload/`, or `renderer/` here. `shared/`
  must remain free of context-specific side effects.
- Keep the settings schema (`settingsSchema.ts`) and types aligned with the
  matching renderer and main process consumers.

## Validation
- After changing any contract in `shared/`, search for every consumer in
  main, preload, and renderer and confirm request/response shapes still
  match.
- Verify schema changes propagate to the settings UI, persistence path, and
  any matching tests.
