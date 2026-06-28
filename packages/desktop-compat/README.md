# @codepilotx/desktop-compat

This is a **transitional compatibility package**. It exposes the legacy `@codepilotx/core` and `@codepilotx/tui` module names that the desktop app uses, by aliasing them to the corresponding sources copied from the original ClaudeCode monorepo.

## Why does this package exist?

The desktop app (`apps/desktop`) was migrated verbatim from the ClaudeCode monorepo. That codebase uses pnpm `npm:` aliases to make `@codepilotx/core` and `@codepilotx/tui` resolve to this package's `src/core` and `src/tui` subtrees, so the desktop source files never had to rewrite their `import` statements.

The eventual goal is to delete most of this package and route the desktop app through the real OpenAI Codex CLI `app-server` JSON-RPC interface, exposed by `@codepilotx/codex-app-server-client`. See the migration plan for details.

## Module layout

```
src/core/   ← packages/core/src from the ClaudeCode monorepo
src/tui/    ← apps/tui/src from the ClaudeCode monorepo
```

## How to delete this package later

1. Replace `@codepilotx/core/...` and `@codepilotx/tui/...` imports with calls into `@codepilotx/codex-app-server-client` or local desktop code.
2. Remove the pnpm `npm:` aliases in `apps/desktop/package.json`.
3. Delete this package and its workspace entry.