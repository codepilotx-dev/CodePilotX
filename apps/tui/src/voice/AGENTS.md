# AGENTS.md

## Scope
Applies to the voice mode wiring under `voice/`.

## Conventions
- Voice mode is feature-gated. The `voiceModeEnabled` flag and related hooks
  in this directory drive enablement; do not assume voice is available in
  headless, server, or remote contexts.
- Reuse the existing audio capture, transcription, and integration plumbing
  rather than introducing parallel paths. New entry points should compose with
  the existing hooks and components.
- Keep voice-mode UI logic in components and screen modules. This directory
  owns enablement, lifecycle, and shared helpers, not full React/Ink views.
- Treat microphone permissions, audio buffering, and streaming transcription
  as cross-platform concerns. Verify Windows and POSIX behavior before
  changing capture or device logic.

## Validation
- When toggling voice enablement or adding a new audio source, confirm the
  feature flag plumbing, keybinding context, and headless-mode guards remain
  consistent.
- For any change that touches audio capture, verify the cleanup path stops
  capture, releases the device, and does not leak listeners on unmount.
