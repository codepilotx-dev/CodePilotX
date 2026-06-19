# Sidebar Flicker Debug Report

- Symptom: Collapsing or hover-opening the desktop sidebar caused the page to flash during state changes.
- Root cause: The collapsed and hover-open sidebar states inherited the base `width` and `flex-basis` transitions, so switching between zero-width layout and absolute overlay triggered a visible layout/paint transition.
- Fix: Disabled transitions on collapsed and hover-open sidebar states, and disabled the collapsed layout opacity transition.
- Evidence: `bun run desktop:typecheck` passed; `git diff --check` reported no whitespace errors.
- Status: DONE_WITH_CONCERNS: static validation passed, but manual Electron UI verification was not run in this turn.
