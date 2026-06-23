# AGENTS.md

## Scope
Applies to remote session support under `remote/`.

## Conventions
- Remote mode multiplexes sessions across processes. Treat any session state
  that crosses the remote boundary as a public contract.
- Reuse the existing session, transport, and direct-connect managers. Do not
  duplicate connection lifecycle logic elsewhere.
- Auth, signing, and identity live in dedicated modules. Do not push raw
  credentials or secrets through the message envelope.
- Keep remote event shapes stable. `SessionsWebSocket.ts`,
  `createDirectConnectSession.ts`, and the adapter modules are paired; update
  both sides in one change.
- Be cross-platform. Verify Windows and POSIX behavior when changing sockets,
  paths, or process spawning.

## Validation
- After changing any transport or session envelope, validate that both
  websocket and direct-connect paths round-trip the affected events.
- Confirm reconnect, resume, and teardown paths still match the documented
  lifecycle in `reconnection.ts` and the matching types.
