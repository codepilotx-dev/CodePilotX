# AGENTS.md

## Scope
Applies to telemetry, tracing, and logging plumbing under
`utils/telemetry/`.

## Conventions
- Telemetry is privacy-sensitive. Do not log raw prompts, file contents,
  tool outputs, secrets, or personally identifying data unless an existing
  metadata type explicitly allows it.
- Reuse existing event definitions, attribute helpers, and exporters rather
  than introducing parallel telemetry paths.
- Keep instrumentation side effects out of hot paths. Tracing should be
  opt-in and cheaply no-op when disabled.
- BigQuery, Perfetto, beta-session, and skill-loaded exporters must remain
  aligned with their schemas. Schema changes require matching updates to
  consumers.
- Logger usage in this directory is for telemetry plumbing; application
  logging lives elsewhere.

## Validation
- After adding or changing events, confirm the attribute names match the
  schema and that disable flags actually suppress emission.
- Verify exporters gracefully handle offline or unauthenticated states
  without retry storms or duplicated events.
