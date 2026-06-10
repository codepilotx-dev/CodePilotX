# DEBUG REPORT

- Symptom: On Windows, long-pressing the desktop window chrome made the window appear to grow.
- Root cause: A temporary renderer-driven drag path used long-press pointer events and `BrowserWindow.setPosition()` through a `moveWindow` IPC. On Windows/Electron this bypasses native titlebar drag semantics and can cause bounds recalculation when the window is maximized, snapped, or otherwise managed by the OS.
- Fix: Removed the JS drag path and `moveWindow` IPC surface. Restored native `-webkit-app-region: drag` behavior, with `no-drag` scoped to actual interactive controls.
- Evidence: `rg` found no remaining `moveWindow` or desktop chrome debug-log calls under `apps/desktop/src`. `bun run typecheck` passed. `bun run desktop:build` passed outside the sandbox after the sandboxed attempt failed with `spawn EPERM`.
- Regression test: No automated Electron interaction test exists in this checkout for Windows titlebar drag. The regression coverage is the targeted type/build check plus removal of the unsafe IPC path.
- Status: DONE_WITH_CONCERNS
