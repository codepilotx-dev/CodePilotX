# AGENTS.md

## Scope
Applies to startup bootstrap modules under `bootstrap/`.

## Conventions
- `bootstrap/` owns early app lifecycle wiring: initial state, runtime
  selection, and entry into `screens/REPL.tsx` or the headless path.
- Keep bootstrap modules free of UI rendering. Components and hooks do not
  belong here.
- Do not perform hidden side effects at module import. Use explicit init
  functions that the entrypoint calls in a defined order.
- Be conservative when changing `bootstrap/state.ts` or other shared bootstrap
  state. Many screens, components, and services read from it on first paint.
- Match the existing separation between runtime selection (`desktopRuntime.ts`)
  and shared bootstrap state (`state.ts`).

## Validation
- After changing bootstrap, exercise both interactive (REPL) and headless
  entrypoints in this checkout when possible.
- Search for any module that imports from `bootstrap/` before changing the
  exported state shape.
