# AGENTS.md

## Scope
Applies to tool implementations under `tools/`.

## Conventions
- Tool directories commonly split runtime logic, `prompt.ts`, `UI.tsx`,
  constants, and helper modules. Keep that separation.
- Prefer `buildTool`, `ToolDef`, `ToolUseContext`, and existing permission
  helpers over ad hoc tool plumbing.
- Keep tool prompts synchronized with runtime behavior. If changing inputs,
  permissions, limits, or result formatting, review the matching prompt and UI
  files in the same directory.
- Be conservative around filesystem, shell, MCP, agent, and permission code.
  Preserve sandbox checks, path validation, truncation, and telemetry metadata.
- Do not weaken security checks to simplify a feature. Add narrowly scoped
  helpers or tests/review notes instead.

## Validation
- For prompt or schema changes, inspect the rendered prompt/schema path if the
  codebase exposes one.
- For tool result changes, review both success and error rendering paths.
