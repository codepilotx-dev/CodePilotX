# AGENTS.md

## Scope
Applies to the model provider layer under `packages/core/src/models/`.

## Conventions
- This package owns model provider implementations and capability metadata.
  Treat the provider interface as a public API.
- Add new providers next to `provider.ts` and follow the existing provider
  shape. Capability metadata belongs alongside the provider, not scattered
  across consumers.
- Preserve the existing capability, alias, and deprecation contracts. The
  TUI and desktop settings UIs depend on the current shape.
- Be conservative around auth, rate limiting, and provider-specific
  headers. New behavior must respect the existing provider config flow.
- Avoid pulling platform-specific or UI code into this package. Keep it
  usable from headless contexts.

## Validation
- After changing a provider or capability, trace consumers in
  `apps/tui/src/utils/model/` and `apps/desktop/src/main/` and confirm the
  capability contract still holds.
- For any new provider, exercise auth, listing, and a representative
  request path before landing.
