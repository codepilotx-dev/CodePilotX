# AGENTS.md

## Scope
Applies to the Electron main process under `apps/desktop/src/main/`.

## Conventions
- This directory runs in the Electron main process with Node access.
  Treat it as a privileged boundary: do not import React/Ink or renderer-only
  modules here.
- IPC channels must go through `shared/ipcChannels.ts` and
  `shared/types.ts`. Do not invent ad hoc channel strings.
- Reuse the existing services (`authRuntimeService`, `mcpSettingsService`,
  `modelProviderService`, `workspaceService`, `sessionPersistence`,
  `windowService`, etc.) rather than adding parallel handlers.
- Preserve the runtime env, settings, and theme services' contracts. The
  desktop settings UI in the renderer depends on them.
- Be conservative around workspace path guards and session persistence. Do
  not relax validation to simplify a feature.
- Avoid hidden side effects at module top level. Initialization belongs in
  explicit boot paths.

## Validation
- After changing an IPC handler or service, trace the matching renderer
  consumer in `apps/desktop/src/renderer/` and confirm the request and
  response shapes still match.
- Verify the desktop dev tools shortcut, debug flags, and runtime env hooks
  do not leak into production builds.
