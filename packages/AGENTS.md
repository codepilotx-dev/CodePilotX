# AGENTS.md

## Scope

These instructions apply to all shared workspaces under `packages/` and extend
the repository-level instructions.

## Package Responsibilities and Dependency Direction

- `model-schema` defines foundational provider, model, integration, connection,
  and credential schemas.
- `provider-plugin` defines statically linked built-in plugins and their ordered
  lifecycle.
- `provider-runtime` defines provider catalogs, runtime construction, variants,
  security filtering, and error normalization.
- `shared` defines application-level API, event, thread, session, and model
  contracts consumed across processes.
- `session-view` performs pure transformations from shared session contracts to
  presentation models.
- Keep dependencies flowing through these public contracts. Do not duplicate a
  lower-level schema or create a circular package dependency.

## Public Interfaces

- Export public APIs from a package's `src/index.ts` or an explicit
  `package.json` export. Consumers must not deep-import internal files.
- When changing schemas or events, update and validate Agent and renderer
  consumers together. Preserve compatibility or migrate every call site in the
  same change.

## Upstream-Derived Code

- Follow the package `UPSTREAM.md` when changing `model-schema`,
  `provider-plugin`, or `provider-runtime`.
- Preserve upstream attribution and license files. Prefer copying or adapting
  the recorded upstream implementation over inventing equivalent logic.
- Do not reintroduce intentionally omitted behavior such as runtime npm
  installation, arbitrary file plugins, unrestricted dynamic imports, or
  external plugin execution.
- When resynchronizing upstream code, update the recorded source, import date,
  and checksums or revision information.
- Preserve provider registration order, security filtering, the static
  allowlist, and error normalization unless the task explicitly changes them.

## Validation

- Run the affected package's `typecheck` script.
- Run its `test` script only when the package defines one and behavior changes
  or a relevant regression test is needed.
- For public contract changes, also validate every direct Agent, Electron, and
  renderer consumer affected by the change.
