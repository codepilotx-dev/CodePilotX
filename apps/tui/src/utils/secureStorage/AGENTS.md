# AGENTS.md

## Scope
Applies to credential and secret storage under `utils/secureStorage/`.

## Conventions
- This directory owns platform-specific secret storage (keychain, fallback
  storage, prefetch, helpers). Treat all storage backends as
  security-sensitive.
- Never log raw secrets, tokens, or credential values. Use the existing
  metadata types when an event needs to record access without leaking
  contents.
- Keep backend selection behind the `index.ts` API. New storage backends
  should plug in through the same shape as existing ones.
- Be cross-platform. Windows credential manager, macOS keychain, and the
  plain-text fallback must agree on the contract even when capabilities
  differ.
- Prefetch and prefetch helpers must not block startup on user input. They
  should fail open or fall back gracefully.

## Validation
- After changing a backend, exercise both the success and fallback paths and
  confirm no secrets are logged or persisted in plaintext unexpectedly.
- For keychain helper changes, verify behavior across cold-start and
  already-unlocked states on macOS and Windows.
