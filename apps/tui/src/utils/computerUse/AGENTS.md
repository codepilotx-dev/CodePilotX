# AGENTS.md

## Scope
Applies to computer-use helpers under `utils/computerUse/`.

## Conventions
- Computer-use code drives mouse and keyboard input, screenshots, and host
  adapters. Treat it as a security-sensitive boundary: input must be
  validated before being applied.
- Reuse the existing executor, gates, host adapter, and Swift loader rather
  than introducing parallel control paths.
- Keep platform-specific loading behind dedicated modules (`swiftLoader.ts`,
  `inputLoader.ts`). New host adapters should match their shape.
- Cleanup paths must run on cancel, error, and shutdown. Do not leave
  dangling locks, captured input, or screen state behind.
- Match the gate and lock contracts in `gates.ts` and
  `computerUseLock.ts`. Bypassing them risks overlapping input across
  runs.

## Validation
- After any change that affects capture, input, or locking, verify cancel,
  failure, and shutdown paths release the lock and stop capture.
- Confirm platform-specific loaders still resolve correctly across macOS,
  Linux, and Windows builds.
