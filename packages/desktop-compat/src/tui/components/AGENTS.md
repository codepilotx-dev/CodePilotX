# AGENTS.md

## Scope
Applies to React/Ink UI components under `components/`.

## Conventions
- Reuse design-system components from `components/design-system/` when possible.
- Keep terminal UI layout predictable: prefer `Box`, `Text`, existing panes,
  bylines, shortcut hints, pickers, and dialogs over custom rendering.
- Respect keybinding focus rules. Components with embedded text input should
  allow parent dialogs or keybinding handlers to be disabled when input is
  active.
- Keep display text short enough for terminal widths and avoid hard-coded
  spacing that will wrap poorly.
- Put business logic outside UI components unless it is purely presentation
  state.

## Validation
- For UI changes, reason through narrow terminal widths, keyboard-only use, and
  cancel/escape behavior.
- When changing shared design-system components, check representative callers.
