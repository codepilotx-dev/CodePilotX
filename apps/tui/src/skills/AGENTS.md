# AGENTS.md

## Scope
Applies to the skill loader and bundled skills under `skills/`.

## Conventions
- Skills are loaded from disk and from bundled assets. Keep the bundled
  skills read-only: do not modify their contents from runtime code.
- Reuse the existing loaders (`loadSkillsDir.ts`, `bundledSkills.ts`) and
  skill change detection rather than adding parallel discovery paths.
- Skill content is user-authored text. Treat it as untrusted input at the
  boundary and avoid logging or persisting raw skill bodies unless an
  existing metadata type explicitly allows it.
- When adding MCP-backed skill builders (`mcpSkillBuilders.ts`), match the
  existing builder contract and hook signature.
- Skill change detection must be conservative: avoid spurious reloads during
  normal editing sessions.

## Validation
- After changing skill loading, verify both bundled and filesystem-sourced
  skills load, refresh on change, and survive missing or malformed entries.
- Confirm skill listing surfaces match what callers in `components/` and
  `commands/` expect.
