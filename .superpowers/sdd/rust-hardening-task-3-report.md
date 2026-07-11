# Task 3 — Loopback HTTP authentication hardening report

## Result

Implementation commit: `fa07fde37` (`feat(desktop)：加固本地 HTTP 鉴权`)

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
- A trusted CORS preflight returns 204 and advertises only `GET, POST` plus
  `Content-Type, X-Auth-Token`. It does not authenticate the subsequent actual
  request.
- `maxBodyBytes` is configurable and defaults to 1 MiB. A declared oversized
  `Content-Length` returns 413 before body buffering. Chunked/streamed bodies
  are counted as bytes and return 413 as soon as the limit is exceeded. A body
  exactly at the limit is accepted.
- Startup/request logs contain no token/header values. Internal handler errors
  use a generic JSON-RPC message so a secret embedded in an exception cannot be
  reflected to the caller.
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
