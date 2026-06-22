# AGENTS.md

## Scope
Applies to permission classification and policy code under
`utils/permissions/`.

## Conventions
- This directory owns permission modes, rules, classifiers, and decision
  shaping for tools, shell, and filesystem access. Treat the public surface
  as a security boundary.
- Do not weaken classifiers, killswitches, or denial tracking to make a
  feature pass. Add narrowly scoped helpers or rule updates instead.
- Preserve existing rule parsing, shadowing, and update flows. Update
  matching schemas in `types/` together with rule changes.
- Be conservative when editing `bypassPermissionsKillswitch.ts`,
  `dangerousPatterns.ts`, and the YOLO classifier. Confirm tests or
  representative inputs still flag the patterns they are meant to catch.
- Cross-platform path and shell behavior matters: re-check Windows and POSIX
  behavior in `pathValidation.ts`, `filesystem.ts`, and `shellRuleMatching.ts`.

## Validation
- For permission rule or schema changes, trace every consumer in `tools/`,
  `commands/`, and the desktop settings UI before landing.
- For classifier changes, include negative cases (commands that should still
  require approval) in the review notes when automated tests are absent.
