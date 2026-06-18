# AGENTS.md

## Scope
These instructions apply to the whole `ClaudeCode` tree unless a nested
`AGENTS.md` says otherwise.

## Project Shape
- This is a TypeScript/TSX CLI and terminal UI codebase.
- Many imports intentionally use `.js` extensions even from `.ts`/`.tsx` files;
  keep that style when adding or changing imports.
- Some files in this checkout include inline `sourceMappingURL` blocks and
  `sourcesContent`. Treat them as part of the current artifact shape: avoid
  broad formatting passes, and keep edits narrowly focused.
- The app only needs to support desktop pages; do not spend effort adapting
  pages for non-desktop viewports unless explicitly requested.
- This checkout may not include package manager or test configuration files.
  Discover available commands before claiming a build or test path exists.

## Editing Rules
- Prefer small, local changes that follow the surrounding file style.
- Prefer UTF-8 when reading code and project files.
- Preserve existing public exports and runtime behavior unless the task
  explicitly asks for an API change.
- Keep code ASCII unless the file already requires non-ASCII content.
- Use typed helpers already present in `utils`, `services`, `Tool.ts`, and
  `types` before adding new utility layers.
- Do not edit generated files by hand. See nested instructions under
  `types/generated`.

## Validation
- First look for nearby existing validation patterns or commands.
- If no runnable test/build command is available in this checkout, do a
  targeted TypeScript/style review of the files you changed and state that
  limitation in the handoff.
