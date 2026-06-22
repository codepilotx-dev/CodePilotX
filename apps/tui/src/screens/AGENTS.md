# AGENTS.md

## Scope
Applies to top-level terminal screens under `screens/`.

## Conventions
- Screens are full-page terminal views (for example `REPL.tsx`,
  `ResumeConversation.tsx`, `Doctor.tsx`). Each screen owns its own layout,
  state, and keybindings at the top level.
- Keep screens thin. Delegate layout atoms to `components/`, data fetching to
  `services/` or `hooks/`, and shared logic to `utils/`.
- Coordinate keybindings through the global keybinding system
  (`keybindings/`, `useKeybinding`, `KeybindingContext`) instead of registering
  raw `useInput` handlers in screens.
- Respect terminal width, focus, and cancellation rules. Reason through narrow
  terminals, keyboard-only use, and escape behavior when changing a screen.
- Reuse existing dialogs, pickers, and design-system components rather than
  building screen-local variants.

## Validation
- After changing a screen, verify it still composes with the global app shell,
  theme switching, and the keybinding focus rules in `components/AGENTS.md`.
- For any visible text change, confirm wording matches the existing command
  tone and shortcut terminology used elsewhere.
