# AGENTS.md

## Scope
Applies to the bash command parser and tooling under `utils/bash/`.

## Conventions
- This directory powers shell command parsing, classification, and risk
  analysis. Treat the parser as a security-sensitive component: small
  changes can flip whether a command is allowed.
- Preserve the existing module split: `parser.ts`, `ast.ts`, `commands.ts`,
  `heredoc.ts`, `prefix.ts`, `registry.ts`, and the `specs/` per-command
  modules. Add new shell commands under `specs/`.
- Be conservative around tree-sitter usage in `treeSitterAnalysis.ts` and
  the `bashPipeCommand.ts` / `ParsedCommand.ts` representations. Other
  subsystems rely on the current AST shape.
- New per-command specs must follow the existing `specs/<name>.ts` shape
  and register through `registry.ts` / `index.ts`.
- Do not weaken classifier checks to make a feature pass. Add narrowly scoped
  helpers or new specs instead.

## Validation
- For any parser or AST change, exercise heredocs, pipelines, command
  substitution, quoting, and per-command specs against representative
  inputs.
- For classifier or registry changes, include edge cases for command
  substitution, env assignments, and multi-line input in the review notes
  when automated tests are not available.
