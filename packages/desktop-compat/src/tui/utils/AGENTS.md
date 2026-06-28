# AGENTS.md

## Scope
Applies to shared infrastructure under `utils/`.

## Conventions
- Utilities are widely shared. Keep changes small and backward-compatible unless
  the task explicitly calls for a contract change.
- Prefer existing helpers for paths, filesystem operations, JSON parsing,
  logging, permissions, shell parsing, config, and telemetry.
- Be cross-platform. Check Windows and POSIX path behavior before changing path,
  shell, filesystem, or environment logic.
- Avoid hidden side effects at module import time. Use explicit initialization
  or existing registries when side effects are required.
- Preserve privacy and security boundaries: do not log raw secrets, file
  contents, prompts, or personally identifying data unless an existing metadata
  type explicitly allows it.

## Validation
- Search for all callers before changing a utility signature or return shape.
- For parser, path, permission, or config changes, include edge cases in the
  review notes when no automated tests are available.
