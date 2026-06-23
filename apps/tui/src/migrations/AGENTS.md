# AGENTS.md

## Scope
Applies to settings migrations under `migrations/`.

## Conventions
- Each migration is a one-way transformation from a legacy settings shape to
  the current one. Migration files are append-only: never edit a landed
  migration.
- Migrations run in order during settings load. The ordering and naming
  convention matters; follow the existing `migrate*` naming style.
- Migrations must be idempotent. A user who upgrades, downgrades, and upgrades
  again must reach the same end state.
- Do not introduce new top-level dependencies inside a migration. Reuse
  helpers already used by other migrations.
- Never log raw settings values or user-identifying data from a migration.

## Validation
- For any new migration, add a forward-only test path if the codebase exposes
  one, otherwise trace through a representative user state by hand.
- Confirm the migration runs only when its precondition is met and that it
  leaves unrelated settings untouched.
