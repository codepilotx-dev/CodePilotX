# Codex-Compatible Convergence Mapping

This document records the compatibility boundary for converging the desktop
client toward Codex semantics without moving repositories in one step.

## Session Contract

| Codex concept | Current desktop surface | Migration status |
| --- | --- | --- |
| `CollaborationMode { mode: Plan }` | `collaborationMode` on session options, settings, list item, session runtime context | Canonical for new/normalized desktop session state. |
| Legacy plan flag | `planModeActive` on UI snapshots and IPC toggle | Kept as derived UI compatibility state. |
| `proposed_plan` event flow | Desktop runtime parses `<proposed_plan>` while plan mode is active | Existing parser/event path retained; activation now derives from collaboration mode. |
| Exit plan approval | `ExitPlanMode` permission request and recovery path | Approval now clears canonical collaboration mode through the shared snapshot helper. |

## Permission And Auto Review

| Codex concept | Current desktop surface | Migration status |
| --- | --- | --- |
| Permission profile | `permissionProfile` / `:workspace` | Already mapped through core permission policy helpers. |
| Approval policy | `approvalPolicy` / `on-request` | Already mapped through core permission policy helpers. |
| Guardian reviewer | `approvalsReviewer: 'auto_review'` | Desktop auto-review service remains an adapter/fallback. |
| Fail-closed review | Read-only reviewer runtime with denied nested permissions | Existing behavior matches the desired guardian-compatible boundary. |

## Subagent Compatibility

| Codex concept | Current desktop/TUI surface | Migration status |
| --- | --- | --- |
| `spawn_agent` | `AgentTool` foreground/background launch states. Completion envelope (`AgentToolResult`) now carries `transcriptPath` and `outputFile` metadata so the parent can discover full subagent artifacts on disk without loading them into context. | Envelope fields added; core state machine unchanged. |
| `wait_agent` | SDK `task_notification` terminal states. Notification now includes `<transcript-path>` alongside `<output-file>`. Final message is character-bounded (`MAX_FINAL_MESSAGE_CHARS = 20K`); truncation notes reference the full-content path. | Notifications enriched with bounded result + transcript path. |
| `send_message` / follow-up | Local task progress and queued task interactions. `agentId` and `transcriptPath` in the sync tool-result trailer let the parent agent reference the subagent's full transcript without re-loading it into context. | Identity + path exposed in sync envelope trailer. |
| Agent thread/source/role metadata | `AgentTool` result/progress plus SDK task events. `AgentToolResult` schema extended with `transcriptPath` and `outputFile`; `enqueueAgentNotification` accepts an optional `transcriptPath` for the async path. | Adapter fields added to existing event types. |

### Subagent Context Boundary

The following isolation properties are now enforced:

- **Subagent transcript isolation**: Full subagent conversation is written to a sidechain JSONL (`<sessionDir>/subagents/agent-<agentId>.jsonl`) via `recordSidechainTranscript()`. It is **not** injected into the main agent's context.
- **Bounded final message**: The subagent's final text content entering the main context is capped at 20,000 characters. If truncated, a note with the `transcriptPath`/`outputFile` is appended so the parent agent can discover the full content.
- **Resume path isolation**: `getAgentTranscript(agentId)` can load the full sidechain transcript independently of the main session transcript.
- **No full-transcript injection**: Subagent messages are never written into the main agent's `messages` array or main session transcript. Only the bounded final message (sync tool_result or async task_notification) enters the parent context.

## Retained Desktop-Specific State

- Electron lifecycle and renderer preload/mock routing.
- Browser-debug bridge selection and local settings storage.
- Legacy `planModeActive` for existing UI controls until renderer state moves
  fully to `collaborationMode`.

## Deprecated Or Derived State

- `planModeActive` is no longer a source of truth when `collaborationMode` is
  present.
- Future AutoReview changes should target guardian outcome semantics
  (`allow`, `deny`, `ask_user` / fallback) instead of adding another reviewer
  abstraction.
- Future subagent changes should project existing `AgentTool` task states into
  Codex multi-agent events before replacing the underlying implementation.
