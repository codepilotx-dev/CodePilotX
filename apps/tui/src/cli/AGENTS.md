# AGENTS.md

## Scope
Applies to CLI command surface under `cli/`.

## Conventions
- `cli/` owns the top-level command-line entrypoint wiring, argument parsing,
  and dispatch into headless or interactive modes.
- Reuse the existing CLI handlers, transports, and structured I/O modules
  rather than reimplementing argument handling in this directory.
- Do not perform long-running work at module top level. Argument parsing and
  dispatch should be lazy and explicit.
- Keep exit codes, error formatting, and stdout/stderr separation consistent
  with the existing helpers (`print.ts`, `exit.ts`).
- New CLI flags should follow existing naming and grouping. Update help text
  and any matching documentation together.

## Validation
- After changing CLI parsing or dispatch, exercise the affected flags and
  confirm exit codes and output formats remain stable.
- For changes that touch structured I/O or transports, confirm headless mode
  still streams events correctly.
