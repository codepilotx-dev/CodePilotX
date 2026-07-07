# AGENTS.md

## Scope
These instructions apply to the whole `ClaudeCode` tree unless a nested
`AGENTS.md` says otherwise.

## Project Shape
- This is a TypeScript/TSX CLI and terminal UI codebase.
- Many imports intentionally use `.js` extensions even from `.ts`/`.tsx` files;
  keep that style when adding or changing imports.
- Some files in this checkout include inline `sourceMappingURL` blocks and
  `sourcesContent`. Treat them as part of the current artifact shape: avoid
  broad formatting passes, and keep edits narrowly focused.
- The app only needs to support desktop pages; do not spend effort adapting
  pages for non-desktop viewports unless explicitly requested.
- This checkout may not include package manager or test configuration files.
  Discover available commands before claiming a build or test path exists.

## Desktop UI Design System
- Desktop UI should use a restrained, professional developer-tool style:
  dense enough for repeated work, but with clear hierarchy, comfortable reading,
  and consistent alignment across pages.
- Keep desktop changes token-driven. Prefer existing global tokens in
  `apps/desktop/src/renderer/styles/base.css` for radius, elevation, spacing,
  typography, and icon sizing before adding local values.
- Preserve the current desktop scope. Do not add mobile adaptations, new
  appearance settings, route changes, or business APIs unless explicitly asked.

### Surfaces, Radius, and Elevation
- Use the established radius/elevation scale for panels, cards, inputs, empty
  states, popovers, modals, selected states, and floating composer surfaces.
- Main panels and repeated cards may use subtle shadows for depth. Avoid heavy
  shadows on every sidebar row or dense list item.
- Popovers, dropdowns, and modals should map to shared radius and shadow tokens;
  avoid hard-coded one-off shadows scattered through feature CSS.
- Sidebars remain low elevation. Emphasize current/active rows with background,
  color, and light elevation only when needed.

### Spacing and Layout
- Use the layout spacing tokens as the default desktop rhythm:
  `--layout-page-pad-x`, `--layout-page-pad-y`,
  `--layout-page-pad-bottom`, `--layout-section-gap`,
  `--layout-card-gap`, `--layout-card-pad`,
  `--layout-toolbar-gap`, `--layout-composer-bottom`, and
  `--layout-composer-safe-pad`.
- Keep quick chat's hero, composer, and main content on the same horizontal
  center line. Prefer compact professional vertical rhythm over large marketing
  gaps.
- Standard desktop pages such as search, plugins, automation, and settings
  should share outer page padding, section gaps, card gaps, and bottom safe
  spacing.
- Sidebars should keep information density while using consistent row padding,
  row height, section gaps, and list gaps.

### Typography and Icons
- Favor reading-first typography with limited bold text. Use body weight `400`,
  labels and card titles around `500`, headings around `560`, and reserve `600`
  for critical emphasis or warning/severity states.
- Desktop page titles should stay near the shared page-title scale, while card
  and section titles should remain lighter and smaller than hero text.
- Markdown content should keep readable line height; headings and `strong`
  should be distinct without becoming overly heavy.
- Icons should use the shared icon tokens by default: normal UI icons `16px`,
  small chevrons/status icons `14px`, feature/card icons `18px`, and large empty
  state icons only where semantically needed. Use the shared stroke width unless
  a platform control explicitly requires a different size.
- Align icon and text spacing consistently inside buttons, tabs, cards, menus,
  and toolbars. Icons should not look visually heavier than adjacent text.

### Desktop Page Patterns
- Quick chat: the welcome card keeps large radius and subtle elevation; the
  composer is the highest-priority floating panel and should have clear focus
  treatment.
- Conversation pages: user bubbles, plan cards, approval cards, and system
  event cards should share card radius, light elevation, readable typography,
  and safe bottom spacing around fixed composers.
- Search and plugins: search inputs, result columns, and plugin cards use the
  same card radius/elevation; hover should raise at most one level and must not
  shift layout.
- Automation: empty states should read as raised panels; internal shortcuts can
  stay pill-shaped without creating extra heavy card layers.
- Settings: section cards, radio cards, and switch rows should keep density.
  Use section-level cards and subtle shadows instead of giving every row a
  strong separate shadow.

### Right Dock
- The right dock header uses `.right-dock-tabs` as a compact tool switcher.
  Keep tab wraps, add buttons, and dock controls on one visual center line.
- Right dock tabs should be styled as complete tab units: a wrapper owns the
  active/hover/focus surface, the tab button owns icon+label, and the close
  button is a small icon button.
- Right dock tab close buttons should stay visually quiet by default and appear
  on hover, active, or focus-within states so keyboard access remains clear.
- Right dock popovers must open below the header without covering the menubar or
  dock tabs. If a shared popover positioning rule conflicts with Radix
  positioning, fix the local popover class rather than changing unrelated menus.

## Editing Rules
- Prefer small, local changes that follow the surrounding file style.
- Prefer UTF-8 when reading code and project files.
- Preserve existing public exports and runtime behavior unless the task
  explicitly asks for an API change.
- Keep code ASCII unless the file already requires non-ASCII content.
- Use typed helpers already present in `utils`, `services`, `Tool.ts`, and
  `types` before adding new utility layers.
- Do not edit generated files by hand. See nested instructions under
  `types/generated`.

## Reference Reuse Workflow
- Before developing any new feature, first inspect `D:\GitHubProject\Agent` for
  similar implementations.
- Use UTF-8 when reading files.
- Search reference repositories with `rg` before writing new logic.
- Prefer same-stack references first:
  1. `D:\GitHubProject\Agent\claude-code-master`
  2. `D:\GitHubProject\Agent\codex-main`
  3. `D:\GitHubProject\Agent\opencode-dev`
  4. `D:\GitHubProject\Agent\openai-agents-python`
- For tasks that explicitly target mobile UI or mobile client behavior, also
  inspect `D:\GitHubProject\Agent\OpenCodeUI-main` first.
- If a matching implementation exists, copy or adapt the existing logic instead
  of inventing a new one.
- If no suitable implementation exists, write the smallest local implementation
  that follows this repository's existing patterns.
- When reusing reference logic, mention the source repository/path in the
  handoff.

## Provider API Keys
- Provider API keys must be stored and read by providerID in secure storage only
  (`providerApiKeys[providerID]`). Environment variable fallback
  (`provider.envVars`, `apiKeyEnvVar`, or `process.env`) is intentionally
  disabled — a shared env var such as `MINIMAX_API_KEY` must not serve as a
   fallback key for multiple providers. Do not reintroduce env‑var fallback
   when adding or modifying provider API key resolution.

## Validation
- First look for nearby existing validation patterns or commands.
- If no runnable test/build command is available in this checkout, do a
  targeted TypeScript/style review of the files you changed and state that
  limitation in the handoff.

## Debugging Notes

### Conversation Debug Dump Tool Results
- When desktop debug mode writes
  `<workspace>/.Temp/conversation-flow-*.json`, inspect both `toolFlow` and
  the next `model_call_start`/provider request. A tool can succeed locally in
  `tool_update_message` but still be missing from the next model context.
- The dump writer lives in `apps/tui/src/utils/conversationDebugDump.ts`.
  It redacts sensitive keys such as `authorization`, `api-key`, `x-api-key`,
  `token`, `secret`, `cookie`, and `password`; ordinary `tool_result.content`
  is not redacted just because it is file content.
- For "tool result missing" symptoms, check these files first:
  `apps/tui/src/query.ts`,
  `apps/tui/src/utils/messages.ts`,
  `apps/tui/src/services/api/minimax.ts`, and
  `apps/tui/src/headless/desktopRuntime.ts`.
- 2026-06-27 root cause: `ensureToolUseResultsForNextTurn()` returned the
  original `toolResults` array when no synthetic result was needed. The caller
  then did `toolResults.length = 0` and `toolResults.push(...pairedToolResults)`;
  because both variables referenced the same array, real tool results were
  cleared before the next model call. `ensureToolResultPairing()` then inserted
  `[Tool result missing due to internal error]`, so the model reported an
  internal tool failure even though the tool had returned content.
- The fix is intentionally small: in `apps/tui/src/query.ts`,
  `ensureToolUseResultsForNextTurn()` must return a fresh array
  (`[...toolResults]`) when no missing results exist, and keep returning
  `[...]` with appended synthetic results when needed. Do not move this fix
  into the provider or the dump redaction path.
- Regression coverage belongs in `apps/tui/src/query.test.ts`. Include a case
  that stores `pairedResults`, clears the original `results` array, pushes the
  paired results back, and verifies the real `tool_result` remains.
- Targeted verification for this class of bug:
  `bun test apps/tui/src/query.test.ts apps/tui/src/utils/conversationDebugDump.test.ts`.
  For manual confirmation, inspect the newest `.Temp/conversation-flow-*.json`
  and verify the next `model_call_start` includes the real `tool_result`, the
  last provider request does not contain `[Tool result missing due to internal
  error]`, and the request contains the successful tool result marker.
