# AGENTS.md

## Scope
Applies to the Electron renderer under `apps/desktop/src/renderer/`.

## Conventions
- The renderer is a React app. Pages, components, and features live here.
  Keep IPC access routed through the preload bridge and the typed
  `DesktopApi` from `shared/types.ts`.
- Reuse existing design-system components in `components/` and `components/ui/`
  rather than building local variants. Layout primitives live in
  `features/layout/`.
- Side effects, IPC, and persistence belong in `services/` and `hooks/`,
  not directly in components. Components should stay declarative.
- Settings changes flow through `desktopClient.ts` and the matching main
  process handler. Avoid reading settings directly from disk in the
  renderer.
- The app only needs to support desktop pages; do not spend effort adapting
  pages for non-desktop viewports unless explicitly requested.
- Match the existing routing and page composition in `routes.tsx` and
  `App.tsx`.

## Validation
- After changing a page or feature, confirm it still respects the desktop
  viewport assumptions, keyboard focus rules, and theme switching.
- For settings UI changes, verify both the local update and the persisted
  state round-trip through the matching main process service.
