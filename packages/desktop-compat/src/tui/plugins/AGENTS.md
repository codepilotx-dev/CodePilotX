# AGENTS.md

## Scope
Applies to the plugin loader and integration under `plugins/`.

## Conventions
- Plugins are loaded as user-installed or bundled extensions. Treat plugin
  code and metadata as untrusted input.
- Reuse the existing plugin loader, manager, marketplace helpers, and MCP
  integration modules. Do not duplicate discovery or install paths.
- Preserve the existing hook, command, agent, and output-style registration
  contracts. Other subsystems depend on these entry points.
- Plugin policy, blocklist, and managed-plugin decisions live in dedicated
  modules. Do not scatter policy checks across feature code.
- For desktop integration, the bundled and builtin plugin lists in this
  directory must stay in sync with the desktop API surface in
  `apps/desktop/src/shared/`.

## Validation
- After changing plugin loading or registration, verify the hook, command,
  and tool pipelines still see the same plugin contributions.
- Confirm marketplace fetch, install, and update paths behave correctly when
  network or signing conditions change.
