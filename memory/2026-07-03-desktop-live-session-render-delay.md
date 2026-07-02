# Desktop live session render delay

## Symptom
During a workflow-backed desktop session, new conversation output did not appear until the conversation flow finished sending.

## Root cause
`ConversationPage` preferred `workflowDerivedState.events` whenever it was non-empty. For sessions with existing workflow history, this masked live `events` emitted by `agent_event` while the next turn was still running.

## Fix
`deriveTimelineSourceEvents()` now prefers live `events` while the session is `running` or `waiting`, then falls back to workflow-derived events after the turn completes.

## Evidence
- `bun test apps/desktop/src/renderer/features/session/ConversationPage.test.ts`
- `bun run desktop:typecheck`

## Regression
Added `prefers live session events while a workflow-backed turn is active` in `ConversationPage.test.ts`.
