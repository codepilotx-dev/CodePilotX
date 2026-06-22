# AGENTS.md

## Scope
Applies to multi-agent / swarm coordination under `utils/swarm/`.

## Conventions
- This directory owns teammate spawning, permission sync, layout, and
  cross-process orchestration. Treat the spawn and permission surface as a
  security boundary.
- Reuse the existing backend registry, leader permission bridge, and
  teammate helpers. Do not invent parallel spawn paths.
- New backends should plug in via `backends/` and register through
  `registry.ts`. Keep backend detection behind `detection.ts`.
- Teammate model and prompt addendum changes affect every spawned
  teammate. Update them with care and trace downstream consumers.
- Cleanup must run on cancel, exit, and crash. Teammate processes, sockets,
  and inbox mailboxes must not leak.

## Validation
- For backend or spawn changes, verify all backends in the registry still
  spawn, sync permissions, and tear down cleanly.
- For permission sync changes, confirm the leader/follower contract still
  matches the docs and that denial paths stay consistent.
