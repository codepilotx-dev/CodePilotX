# ClaudeCode Local Development

This checkout has been restored as a Bun-first local development project for the ClaudeCode CLI/TUI code snapshot.

## Requirements

- Bun 1.3 or newer
- Node.js 22 or newer for compatibility scripts

## Install

```sh
bun install
```

## Common Commands

```sh
bun run deps:audit
bun run typecheck
bun run build
bun run smoke
bun run check
```

`bun run build` bundles `src/entrypoints/cli.tsx` to `dist/claude.js` with local development macro values. Internal feature flags are left disabled by default.

## Local Acceptance

The local development target is intentionally limited:

- `bun dist/claude.js --version` works.
- `bun dist/claude.js --help` works.
- The CLI can enter the normal pre-authentication or prompt flow without crashing on missing project metadata.

Full authenticated Claude requests, internal Anthropic-only features, private MCP integrations, and native platform integrations are outside this local restoration target.

`bun run typecheck` currently runs TypeScript's parser/config pass with `--noCheck`. The checkout is missing original generated SDK types and internal modules, so full semantic checking needs the original repository generation pipeline before it can be made strict again.

## Notes

- Imports intentionally use `.js` extensions from `.ts` and `.tsx` files. Keep that style.
- `src/*` is configured as an alias to `src/`.
- Private `@ant/*` and native packages are represented by local stubs when public packages are unavailable.
- Do not edit `types/generated/` by hand.

