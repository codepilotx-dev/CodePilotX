# Sidebar Session Title Priority Debug

## Symptom
Clicking an active session row from the desktop sidebar could make the conversation header show the user's first message instead of the expected manually edited or AI-generated title.

## Root Cause
The sidebar list uses `sessionDisplayTitle`, which checks `sessionName`, `customTitle`, `aiTitle`, then `firstPrompt`. The conversation header in `DesktopLayout` only passed `sessionName` and `aiTitle` into `QuickChatView`, so it did not honor `customTitle` before falling back to a derived first-message title.

## Fix
`DesktopLayout` now passes `customTitle` between `sessionName` and `aiTitle` for the quick chat title. `QuickChatView` keeps the fallback to the first user message only when no manual or AI title is available.

## Verification
Ran `bunx tsc --noEmit --noCheck -p apps/desktop/tsconfig.json`.
