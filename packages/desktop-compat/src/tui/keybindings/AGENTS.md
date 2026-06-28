# AGENTS.md

## Scope
Applies to the keybinding system under `keybindings/`.

## Conventions
- Keybindings are declared through the schema, parser, resolver, and provider
  in this directory. Do not register raw `useInput` handlers for shortcuts
  outside this system.
- Reuse `KeybindingContext`, `useKeybinding`, and `useShortcutDisplay` rather
  than wiring ad hoc shortcut logic in components.
- Components with embedded text input must disable parent keybinding handlers
  while the input is focused. Hooks should expose the necessary opt-out API.
- Preserve the existing chord, modal, and reserved-shortcut rules. New
  shortcuts must respect `reservedShortcuts.ts` and the matching context.
- When changing user-facing shortcut text, keep wording consistent with the
  shortcut format used elsewhere (for example `Ctrl+C`, `Shift+Tab`).
- Keep `defaultBindings.ts` declarative. Provider setup and runtime resolution
  belong in their dedicated modules.

## Validation
- After editing bindings, verify common shortcuts still fire correctly and
  that reserved or modal-only bindings cannot leak to other contexts.
- For shortcut display changes, reason through narrow terminal widths and
  confirm display helpers truncate safely.
