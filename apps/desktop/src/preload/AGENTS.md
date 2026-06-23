# AGENTS.md

## Scope
Applies to the Electron preload script under `apps/desktop/src/preload/`.

## Conventions
- The preload script runs in a privileged context bridging main and
  renderer. Treat it as a security boundary: do not expose raw IPC handles
  or unbounded `ipcRenderer` access.
- Expose a narrow, typed `DesktopApi` surface. The current shape lives in
  `preload/index.ts` and matches `shared/types.ts`.
- Channel names must come from `shared/ipcChannels.ts`. Do not introduce
  ad hoc string channels.
- Renderer-facing API methods should be thin wrappers over `ipcRenderer`
  with explicit argument and return types.
- Do not perform side effects at module top level beyond the bridge
  registration. Heavy logic belongs in the main process.

## Validation
- After any new API method, confirm the matching handler exists in
  `apps/desktop/src/main/` and that `shared/types.ts` covers the new
  signature.
- Verify `contextBridge` isolation: the preload must not leak Node-only
  globals to the renderer.
