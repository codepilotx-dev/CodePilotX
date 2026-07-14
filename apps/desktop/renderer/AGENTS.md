# AGENTS.md

## Scope

These instructions apply to the React 19 and Vite 7 renderer workspace under
`apps/desktop/renderer/` and extend the repository-level instructions.

## Workspace Boundaries

- Keep bridge, settings, workflow, and other cross-context types in `shared/`.
  Keep UI implementation in `src/` and renderer tests in `test/`.
- Access system capabilities only through the existing preload bridge and Agent
  clients. Do not use Node.js, SQLite, credentials, or the filesystem directly.
- Reuse `desktopClient`, `agentRpcClient`, `agentThreadAdapter`, and the shared
  workflow reducer for API, SSE, and thread-state transitions. Do not create a
  second transport or state protocol.
- Preserve the desktop-first layout. Do not add mobile or narrow-viewport
  behavior unless the task explicitly requires it.

## Tests and Validation

- Keep tests focused on state transitions, client contracts, and concrete
  regressions. Add them under the existing `test/` directory.
- Run `bun run --cwd apps/desktop/renderer typecheck` for renderer code changes.
- Run `bun run --cwd apps/desktop/renderer build` for UI build, Vite, TypeScript
  project-reference, or asset-pipeline changes.
- Run relevant Bun tests only when the affected behavior has test coverage or a
  regression test is necessary.
