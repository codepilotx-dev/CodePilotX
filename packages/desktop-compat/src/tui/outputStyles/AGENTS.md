# AGENTS.md

## Scope
Applies to output style rendering under `outputStyles/`.

## Conventions
- Output styles shape how assistant responses and tool output are presented in
  the terminal. Keep the rendering logic separate from data fetching.
- Reuse the existing style loaders (`loadOutputStylesDir.ts`,
  `builtinPlugins.ts`) rather than introducing new discovery paths.
- Preserve the public output style contract (name, description, render
  function). User-authored output styles are untrusted; validate the shape
  before invoking the renderer.
- Match the existing module split between placeholder rendering, diff
  suggestions, and unified suggestions.
- Style changes must remain consistent with terminal width handling and
  ANSI rules in `ink/`. Avoid hard-coded spacing that wraps poorly.

## Validation
- After changing output style loading or rendering, exercise narrow terminal
  widths and confirm cancellation and error paths still render cleanly.
- Confirm that style changes apply consistently across interactive and
  headless output paths where they overlap.
