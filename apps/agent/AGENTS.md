# AGENTS.md

## Scope

These instructions apply to the Bun Agent workspace under `apps/agent/` and
extend the repository-level instructions.

## Architecture

- Use `src/index.ts` as the executable entry point and preserve the Agent as a
  modular monolith. Do not move Agent business logic into Electron.
- Keep HTTP, RPC, SSE, projections, and renderer proxying in `src/transport/`.
- Keep thread state and history in `src/session/`, and staged Agent execution in
  `src/orchestration/`.
- Keep SQLite, transactions, the outbox, and event distribution in
  `src/storage/`.
- Keep approvals and tool registration in `src/permission/` and `src/tool/`.
- Keep provider integration and model bridging in `src/provider/` and
  `src/llm/`.

## Conventions

- Reuse the existing Effect services, layers, and error model. Do not introduce
  an incompatible Promise or exception architecture; adapt to Promises only at
  existing external boundaries.
- Commit business state and outbox events in the same database transaction.
  Preserve WAL, foreign keys, busy timeout, SSE cursor replay, and interrupted
  recovery behavior.
- Route credentials through the existing encrypted credential repository and
  Bun secrets flow. Never write them to SQLite, events, or logs.
- Define cross-application API and event contracts in `@codepilotx/shared`.
  Reuse the model schema, provider plugin, and provider runtime packages for
  provider contracts.
- Register new tools through `ToolRegistry` and the existing approval boundary.
  Do not bypass permission checks.

## Validation

- Run `bun run --cwd apps/agent typecheck` for Agent code changes.
- Run `bun run --cwd apps/agent test` when behavior changes or a relevant
  regression test exists.
- Run `bun run --cwd apps/agent build` only for sidecar entry-point, compilation,
  or packaging-related changes.
