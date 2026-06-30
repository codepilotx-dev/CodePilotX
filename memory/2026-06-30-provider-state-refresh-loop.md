# 2026-06-30 Provider State Refresh Loop

## Symptom
Desktop debug logs showed repeated `model_provider_key_state` entries for the same `minimax-cn-coding-plan` provider/key fingerprint within seconds. The renderer no longer visibly flickered, but the main process kept reading provider state.

## Root Cause
`syncExternalSettingsPatch()` captured `effectiveSettings` in its callback dependencies. `DesktopLayout.refreshProviderState()` depended on that callback, and its effect depended on `refreshProviderState`. A provider-state sync could therefore change the callback identity and retrigger the effect, causing repeated `getModelProviderState()` calls for identical state.

## Fix
`syncExternalSettingsPatch()` now reads the latest settings through a ref so its identity stays stable, and unchanged external patches no-op without creating new settings/draft objects. Dirty keys for external patch fields are still cleared.

## Evidence
- `bun test apps/desktop/src/renderer/features/settings/SettingsPage.test.tsx`
- `bun run desktop:typecheck`
