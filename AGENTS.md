# AGENTS.md

## Scope

These instructions apply to the entire CodePilotX repository. More specific
`AGENTS.md` files override or extend them for their directory trees.

## Repository

- CodePilotX is a Windows-first TypeScript monorepo using Bun 1.3.14.
- `apps/agent/` contains the Bun + Effect modular monolith, including HTTP/SSE,
  sessions, SQLite, providers, tools, and permissions.
- `apps/desktop/electron/` contains the Electron main process, preload bridge,
  Agent sidecar lifecycle, and Windows packaging.
- `apps/desktop/renderer/` contains the React and Vite desktop renderer.
- `packages/` contains shared contracts, view projections, model schemas,
  provider plugins, and provider runtime code.

## Working Conventions

- Read and write text files as UTF-8.
- Inspect the current implementation before editing. Reuse or adapt existing
  code instead of introducing a parallel implementation when possible.
- Ask before proceeding when requirements, boundaries, or high-impact
  tradeoffs remain ambiguous.
- Use sub-agents for large or meaningfully parallel tasks. Handle small,
  tightly coupled changes directly.
- Add only tests that are directly relevant to the change and protect useful
  behavior from regression.
- Do not modify unrelated files or overwrite changes that belong to the user.

## Architecture and Security Boundaries

- Keep renderer code isolated from Node.js, the filesystem, credentials, and
  direct database access. Route system capabilities through the existing typed
  preload or Agent client boundaries.
- Keep the preload bridge minimal and typed. Do not expose broad Electron or
  Node.js APIs to the renderer.
- Keep session, SQLite, provider, tool, permission, and orchestration business
  logic in `apps/agent/`, not in Electron or the renderer.
- Never persist API keys in SQLite or include credentials in logs, events, or
  error messages.
- Preserve the same-origin development proxy, SSE cursor replay, transactional
  outbox behavior, and interrupted-task recovery semantics.

## Commands and Validation

- Run the development stack with `bun run dev`.
- Run the repository typecheck with `bun run typecheck`.
- Build individual layers with `bun run build:renderer`,
  `bun run build:agent`, or `bun run build:desktop`.
- Build the Windows installer with `bun run package:win` only when packaging or
  release behavior is in scope.
- By default, run typechecks and tests only for affected workspaces. When a
  cross-workspace contract changes, validate every affected consumer.
- Run repository-wide checks, builds, or packaging only when the change crosses
  those boundaries or the task explicitly requires them.

## Commits

- Create a commit only when the user explicitly requests one.
- Use Chinese Conventional Commit messages in the form
  `feat(desktop)：中文说明`.
- Replace `feat` and `desktop` with the actual change type and workspace scope.
