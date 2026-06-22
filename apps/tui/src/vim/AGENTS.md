# AGENTS.md

## Scope
Applies to the vim input mode under `vim/`.

## Conventions
- This subsystem reimplements a small subset of vim motions, operators, text
  objects, and transitions. Keep the mode transitions, types, and parser
  aligned with the existing module split.
- Vim mode is opt-in. Respect the `voiceModeEnabled`/`worktreeModeEnabled`
  style gating pattern and do not enable vim on screens that have not opted
  in.
- Coordinate with the keybinding system. Vim keystrokes that overlap with
  global shortcuts must be resolved through the keybinding context, not by
  bypassing it.
- Keep command parsing deterministic. Avoid implicit state; explicit transitions
  in `transitions.ts` should drive mode changes.
- Reuse the existing input buffer, history, and rendering hooks rather than
  duplicating them inside vim-specific modules.

## Validation
- Trace the full key path (keybinding context, vim transitions, mode state)
  when adding motions, operators, or text objects.
- Test against common edge cases: empty buffer, line boundaries, count
  prefixes, and rapid mode switches.
