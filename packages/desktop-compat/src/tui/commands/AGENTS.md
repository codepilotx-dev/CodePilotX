# AGENTS.md

## Scope
Applies to slash-command implementations under `commands/`.

## Conventions
- A command directory usually exposes an `index.ts` plus a focused command
  implementation file. Keep that pattern when adding command modules.
- Preserve the existing `call(...)` entrypoint shape and the command types from
  `types/command.js`.
- For JSX commands, return React/Ink nodes directly and keep command modules
  thin. Put reusable UI in `components/` and reusable logic in `utils/` or a
  command-local helper.
- Keep command behavior explicit: validate inputs close to the command boundary
  and use existing dialogs, pickers, and settings components instead of adding
  one-off terminal UI.

## Validation
- Check the command registration/export path after changing a command.
- When changing user-facing command text, verify it matches the existing
  command tone and shortcut/keybinding terminology.
