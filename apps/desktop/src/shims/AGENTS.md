# AGENTS.md

## Scope
Applies to bundler and runtime shims under `apps/desktop/src/shims/`.

## Conventions
- Shims adapt optional or platform-specific APIs (for example `bun:bundle`)
  to a stable shape usable from TypeScript. Treat them as thin adapters.
- Do not place business logic in shims. New behavior belongs in the
  matching service or module.
- Match the existing shim shape: a default export plus named functions with
  the same name as the upstream feature.
- Keep TypeScript types narrow. Avoid `any` returns from shims; prefer
  `boolean`, `string`, or explicit unions.

## Validation
- For any new shim, confirm the corresponding type declaration in
  `typecheck-shims/` (or generated types) stays in sync.
- Verify the shim's no-op default keeps the build green when the upstream
  feature is unavailable.
