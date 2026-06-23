# AGENTS.md

## Scope
Applies to global state and stores under `state/`.

## Conventions
- `state/` owns cross-screen application state, derived selectors, and
  change subscriptions. Keep state modules free of UI rendering and side
  effects beyond declared subscriptions.
- Treat the store shape as a public contract. Selectors, change handlers,
  and teammate view helpers must remain stable.
- Reuse the existing AppState store and selectors rather than introducing
  parallel state stores. New shared state should live alongside existing
  state in this directory.
- Avoid hidden side effects at module import. Side effects belong inside
  init functions or explicit subscriptions.
- Be cautious when threading teammate view state. Cross-agent state must
  stay isolated per teammate.

## Validation
- Search for all consumers before renaming or reshaping any exported state
  slice, action, or selector.
- After changing the store, verify that subscription cleanup runs on unmount
  and that selectors stay referentially stable where callers rely on it.
