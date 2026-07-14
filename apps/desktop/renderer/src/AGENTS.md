# AGENTS.md

## Scope

These instructions apply to UI source code under
`apps/desktop/renderer/src/` and extend the renderer workspace instructions.

## Conventions

- Follow the existing route and page composition in `routes.tsx` and `App.tsx`.
- Reuse components from `components/ui/`, design-system tokens, and existing
  feature components instead of creating local visual variants.
- Keep React components declarative. Put network, IPC, persistence, and
  subscription side effects in services, hooks, or the existing feature state
  layer.
- Process session events through the existing adapters and reducers. Do not
  interpret a new server wire format directly inside UI components.
- Route settings changes through the existing settings hooks, storage helpers,
  and desktop client, and preserve the persisted-state round trip.
- Reuse `styles/design-system/tokens.scss` and the existing feature/component
  SCSS layers instead of adding isolated styling systems.

## Validation

- For UI changes, check desktop window sizing, keyboard focus, theme switching,
  reduced-motion behavior, popover positioning, and session restoration when
  relevant.
- For settings changes, verify both the local update and the persisted-state
  round trip through the existing service boundary.
