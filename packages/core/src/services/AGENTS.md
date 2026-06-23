# AGENTS.md

## Scope
Applies to core services under `packages/core/src/services/`.

## Conventions
- Core services (`api/`, `oauth/`) provide cross-cutting functionality to
  the TUI, desktop, and external tooling. Treat service exports as a
  public API.
- Reuse the existing OAuth and API modules. New auth or API helpers belong
  in this directory, not duplicated across packages.
- Keep network and auth boundaries inside the service. Do not leak raw
  fetch handles or tokens to callers.
- Be cross-platform. Verify Windows and POSIX behavior for any path,
  filesystem, or shell code added to this package.
- Do not perform hidden side effects at module top level. Use explicit
  init functions when state needs to be set up.

## Validation
- After changing any service, search for consumers across `apps/tui`,
  `apps/desktop`, and the desktop main process before landing.
- For OAuth or token changes, confirm refresh, logout, and re-auth flows
  still terminate cleanly and never log raw tokens.
