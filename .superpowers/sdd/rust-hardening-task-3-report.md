# Task 3 — Loopback HTTP authentication hardening report

## Result

Implementation commit: `fa07fde37` (`feat(desktop)：加固本地 HTTP 鉴权`)

Review-fix commit: `191677f9b` (`feat(desktop)：修复 HTTP 安全复审问题`)

Changed files:

- `packages/core/src/appServer/httpServer.ts`
- `packages/core/src/appServer/httpServer.test.ts`
- `apps/tui/src/entrypoints/appServerHttp.ts`

No changes were made to `.superpowers/sdd/progress.md`.

## TDD evidence

RED command:

```powershell
bun test packages/core/src/appServer/httpServer.test.ts
```

Initial result: `1 pass, 8 fail`. The failures showed the pre-fix behavior:

- loopback JSON-RPC without a token returned 200;
- `/healthz` exposed `port` and `sseClients`;
- unauthenticated SSE returned 200;
- unknown browser Origin and its preflight were accepted;
- over-limit and declared-over-limit bodies reached parsing/dispatch paths;
- an internal handler error reflected the sentinel token in the response.

GREEN commands:

```powershell
bun test packages/core/src/appServer/httpServer.test.ts apps/tui/src/entrypoints/appServerHttp.test.ts
bun run typecheck
git diff --check
```

Results immediately before the implementation commit:

- focused tests: `10 pass, 0 fail, 27 expect() calls`;
- repository typecheck gate: exit 0;
- diff whitespace check: exit 0 (line-ending warnings only).

## Exact policy

- `/healthz` is the only unauthenticated route and returns only
  `{ "status": "ok" }`.
- Every non-health actual request, including `/events`, requires the existing
  `X-Auth-Token` header. Loopback addresses no longer bypass authentication.
- Header comparison uses equal-length buffers and Node's `timingSafeEqual`.
  Query-string tokens are not parsed or accepted.
- `trustedOrigins` is an exact Origin allowlist. Its default is empty.
  Requests without an Origin remain available to local non-browser clients;
  requests carrying an unknown Origin (including `null`) return 403 before
  authentication, routing, buffering, or handler dispatch.
- Only a trusted Origin with a complete, allowed
  `Access-Control-Request-Method` and allowed requested headers is treated as a
  CORS preflight. It returns 204 and advertises only `GET, POST` plus
  `Content-Type, X-Auth-Token`. Incomplete/no-Origin OPTIONS requests pass
  through normal token authentication and routing.
- `maxBodyBytes` is configurable and defaults to 1 MiB. A declared oversized
  `Content-Length` returns 413 before body buffering. Chunked/streamed bodies
  are counted as bytes and return 413 as soon as the limit is exceeded. A body
  exactly at the limit is accepted.
- Both declared and streamed oversize responses include `Connection: close`.
  After ending the response, the server allows a bounded 50 ms loopback flush
  window before force-destroying any socket that remains open. Body collection
  uses single-settle cleanup for `data`, `end`, `error`, and `aborted`
  listeners, preventing duplicate responses and retained listeners.
- Startup/request logs contain no token/header values. Internal handler errors
  use a generic JSON-RPC message so a secret embedded in an exception cannot be
  reflected to the caller.
- Request logging parses and records only the pathname; query strings and their
  values are never written to diagnostics.
- The existing stdout `app_server_ready` payload still carries the generated
  token to the parent process; only the stderr diagnostic token prefix was
  removed.

## Reference reuse

- Constant-time comparison structure adapted from
  `D:\GitHubProject\Agent\opencode-dev\packages\console\core\src\util\crypto.ts`.
- Origin rejection order follows the transport-edge policy in
  `D:\GitHubProject\Agent\codex-main\codex-rs\app-server-transport\src\transport\websocket.rs`.

## Limitations

- No repository caller currently consumes this local `/events` endpoint.
  Browser-native `EventSource` cannot attach `X-Auth-Token`; a future renderer
  caller must use authenticated `fetch` streaming or an equivalent controlled
  client. Query-token fallback is intentionally not supported.
- The strict full TypeScript projects contain unrelated pre-existing errors;
  the repository's supported `bun run typecheck` gate (core/TUI `--noCheck`
  plus strict desktop typecheck) passed.

## Review follow-up evidence

The three review regressions were reproduced together before the follow-up
implementation: `9 pass, 3 fail`. The failures showed a query sentinel in the
request log, incomplete/no-Origin OPTIONS returning 204, and a continuously
uploading socket remaining open without `Connection: close`.

After the follow-up:

- focused HTTP suite passed 20 consecutive reruns;
- combined HTTP and entrypoint suite passed `13 tests, 0 fail, 44 expect()`;
- `bun run typecheck` and `git diff --check` exited 0;
- streamed oversize coverage observes one 413 response, server-side socket
  close, zero handler calls, and zero retained `data`, `end`, `error`, or
  `aborted` listeners;
- the declared-oversize close regression was temporarily verified against the
  pre-fix response path, where it failed because `Connection: close` was
  absent, then passed again after restoring the fix.
