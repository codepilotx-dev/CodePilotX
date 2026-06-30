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
| `spawn_agent` | `AgentTool` foreground/background launch states | Pending adapter; do not rewrite the task state machine yet. |
| `wait_agent` | SDK `task_notification` terminal states | Pending workflow projection mapping. |
| `send_message` / follow-up | Local task progress and queued task interactions | Pending agent control service boundary. |
| Agent thread/source/role metadata | `AgentTool` result/progress plus SDK task events | Pending contract-facing adapter over existing events. |

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
