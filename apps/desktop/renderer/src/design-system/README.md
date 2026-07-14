# Claude Desktop Design System

This directory contains the desktop renderer design system used to map the
existing app to the Claude-inspired visual direction from `DESIGN-claude.md`.

## Files

- `tokens.css` defines the theme variables. It intentionally preserves the
  existing `--c-*`, `--surface-*`, `--layout-*`, and `--radius-*` contracts so
  current pages can adopt the new visual system without React or IPC changes.
- `primitives.css` is the final visual pass for shared surfaces and existing
  desktop selectors. It keeps repeated page styles consistent while avoiding
  broad TSX rewrites.

## Rules

- Use warm cream canvas, warm ink text, coral primary actions, and dark product
  surfaces for code, diff, terminal, and preview chrome.
- Keep the app all-sans. Licensed Claude display fonts are not used.
- Keep desktop density. Do not add mobile-only layout work unless requested.
- App-owned primary actions use coral. Third-party plugin logos may keep their
  own brand colors.
- Prefer token and primitive updates before adding page-specific hard-coded
  colors.
