# AGENTS.md

## Scope

These instructions apply to the Electron workspace under
`apps/desktop/electron/` and extend the repository-level instructions.

## Responsibilities

- Keep Electron focused on windows, preload, secure cookies, the Agent sidecar
  lifecycle, desktop integration, and installer packaging.
- Keep `src/main.ts` focused on orchestration. Put sidecar command construction
  in `src/sidecar-command.ts` and use `src/desktop-logger.ts` for logging.
- Do not move provider, session, SQLite, or other application business state
  into the Electron main process.

## Security and IPC

- Preserve context isolation, keep Node.js disabled in the renderer, and expose
  only minimal capabilities through preload.
- Give each new IPC capability an explicit channel, validate renderer input,
  expose the smallest practical preload API, and update the renderer's shared
  types at the same time.
- Never expose raw Electron objects, Node.js modules, credentials, or arbitrary
  filesystem access to the renderer.

## Packaging

- Preserve the `extraResources` layout for the Agent executable, model snapshot,
  renderer output, third-party notices, and third-party licenses.
- Keep development and packaged sidecar paths compatible with the existing
  lifecycle and command construction.

## Validation

- Run `bun run --cwd apps/desktop/electron typecheck` for Electron code changes.
- Run the relevant Bun test when sidecar command behavior changes.
- For packaging configuration changes, run `bun run build:desktop` first. Run
  `bun run package:win` only when the user requests release validation or the
  installer itself is in scope.
