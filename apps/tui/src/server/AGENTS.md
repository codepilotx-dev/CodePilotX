# AGENTS.md

## Scope
Applies to the local server entry under `server/`.

## Conventions
- The server entry exposes the same capabilities as headless mode but over a
  network or local socket. Reuse headless handlers and transports rather than
  reimplementing logic here.
- Auth, CORS, and rate-limiting decisions live in dedicated helpers. Do not
  scatter them across route handlers.
- Keep request and response shapes consistent with the existing JSON-RPC and
  NDJSON conventions used by headless and remote modes.
- Treat the server as untrusted at the boundary. Validate and sanitize input
  even when it originates from the local machine.

## Validation
- After changing routes, transports, or auth, verify the server still
  interoperates with the matching headless and remote clients.
- Confirm graceful shutdown closes transports and does not leave dangling
  child processes or open sockets.
