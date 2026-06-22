# AGENTS.md

## Scope
Applies to core utilities under `packages/core/src/utils/`.

## Conventions
- This directory exposes small, focused helpers used across packages.
  Treat utility exports as a public API; keep changes small and
  backward-compatible unless the task explicitly asks for a contract
  change.
- Reuse existing helpers for auth, config, and settings. New utilities
  belong alongside their neighbors rather than in unrelated modules.
- Be cross-platform. Check Windows and POSIX path, shell, and filesystem
  behavior before changing path, env, or config code.
- Avoid hidden side effects at module import. Use explicit init functions
  when state needs to be set up.
- Privacy and security boundaries: do not log raw secrets, tokens,
  prompts, or user-identifying data unless an existing metadata type
  explicitly allows it.

## Validation
- Search for every caller of a utility before changing its signature or
  return shape.
- For parser, path, permission, or config changes, include edge cases in
  the review notes when automated tests are not available.
