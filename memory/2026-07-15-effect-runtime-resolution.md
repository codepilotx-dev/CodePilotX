# Effect runtime resolution failure

## Symptom

`bun run dev` reported that `effect/dist/index.d.ts` could not resolve
`./Function.ts`. Bun also warned that workspace source files were outside the
Agent watch project directory.

## Root cause

`packages/shared/tsconfig.json` mapped the runtime package name `effect`
directly to `effect/dist/index.d.ts`. Bun honors package-local TypeScript path
aliases while executing workspace source, so it loaded the declaration entry
instead of Effect's exported `dist/index.js` runtime entry.

The Agent watcher was also launched with `apps/agent` as its working directory,
which excluded imported workspace packages from its watch boundary.

## Fix

- Removed the `effect` declaration-file path override from the shared package.
- Started the Agent watcher from the repository root in `scripts/dev.ts`.

## Evidence

- Direct Bun import of `packages/shared/src/thread.ts` succeeds.
- Root-scoped Agent watcher reaches `/api/ready`.
- Full typecheck, Renderer build, and compiled Agent build pass.
- Fresh development startup reaches Renderer and Agent readiness without the
  original error or watch-boundary warnings.

## Status

DONE
