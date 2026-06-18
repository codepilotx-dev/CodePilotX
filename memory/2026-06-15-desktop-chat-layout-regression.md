# 2026-06-15 Desktop Chat Layout Regression

## Symptom

After applying the desktop chat layout change, standalone quick-chat sessions
showed an environment panel with "无项目", and raw internal event labels such as
`done`, `running`, and `init` appeared inside the conversation stream.

## Root Cause

`QuickChatView` rendered all `status` and `checkpoint` timeline events as visible
text. Those events are internal session lifecycle markers, not user-facing chat
content. The new two-column layout also rendered the environment panel for every
conversation route, including standalone chats where `currentWorkspace` is null.

## Fix

- Hide `status` and `checkpoint` events in `TimelineEvent`.
- Only render the environment panel when a real project workspace path exists.
- Make `quick-chat-workspace` single-column by default and enable the right
  environment column only with `with-environment-panel`.

Touched files:

- `apps/desktop/src/renderer/components/QuickChatView.tsx`
- `apps/desktop/src/renderer/styles/main.css`

## Evidence

- `bun run typecheck` passed.
- `bun run desktop:build` passed.
- `git diff --check` passed for the touched UI files; output only contained the
  existing CRLF normalization warnings.

## Status

DONE_WITH_CONCERNS: Build and type verification pass. Full visual verification
inside Electron is still limited by this environment's inability to screenshot
the Electron renderer reliably.
