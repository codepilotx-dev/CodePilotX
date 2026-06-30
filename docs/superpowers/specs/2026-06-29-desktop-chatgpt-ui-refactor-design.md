# Desktop ChatGPT-Style UI Refactoring

## Objective
Refactor the desktop renderer UI to adopt a ChatGPT-inspired visual system:
quiet white canvas, low-contrast borders, soft shadows, left-sidebar + center
chat + bottom composer, reduced card heaviness, unified control styling across
all views.  Light theme is the primary acceptance target; dark theme is adapted
in parallel without pixel-perfect polish.

## Scope
- **In scope**: visual tokens (`base.css`), app shell + navigation styles,
  conversation page layout & sidebar removal, quick-chat, search, plugins,
  automation, settings page styling.
- **Out of scope**: business data flow, IPC, session state, message submission,
  permission approval logic, routing, shared types, mobile viewports.

## Confirmed Decisions

| Decision | Choice |
|---|---|
| WorkflowNodeSidebar | Remove only the rendering JSX + its CSS; keep `buildWorkflowNodes` and derivation helpers (diagnostics/debug reuse) |
| Composer weight | Subtle border + reduced shadow, lighter background gradient fade |
| Right dock min-width | No change (current 560px) |

## Changes

### 1. `base.css` – Visual Tokens
- Add ChatGPT-style token overrides: softer `--c-bg` (pure white #fff),
  lighter `--c-border` (gray-4/5), reduced `--sh-card`/`--sh-card-lg`,
  8 px rhythm preserved, MiSans/system font stack unchanged.
- Keep `--composer-w: 760px` as the core chat width.
- Ensure dark theme tokens remain readable (gray-1 bg, gray-6/5 borders).

### 2. `ConversationPage.tsx` – Remove WorkflowSidebar
- Remove `<WorkflowNodeSidebar nodes={workflowNodes} />` from JSX (line 679).
- Remove `WorkflowNodeSidebar` function component (lines 1234–1286).
- Keep `workflowNodes`, `buildWorkflowNodes`, `workflowNodeFromTimelineItem`,
  `workflowNodeKindForPermission`, `workflowTitleForPermission`,
  `filePatchNodeDetail`, `trimNodeTitle` for potential reuse.

### 3. `session.css` – Chat Layout & Composer
- Remove `.workflow-page__sidebar`, `.workflow-page__timeline`,
  `.workflow-node*`, `.workflow-page__sidebar-title`, related styles.
- Keep `.app-shell.menubar-debug-mode .workflow-page__sidebar` toggle path
  (the debug sidebar belongs to `layout.css` and is unrelated).
- Adjust `.workflow-page__scroll` padding (reduce top padding).
- Adjust `.workflow-page__composer-inner`: reduce `box-shadow` weight,
  keep `border`, keep `focus-within` border highlight.
- Remove `.workflow-page .quick-chat-content.workflow-page__inner` override
  (or confirm it already matches 760px).

### 4. `QuickChatView.tsx` + `session.css`
- `.quick-chat-view`: reduce hero gap from 45px → 32px, keep centered layout.
- `.quick-chat-hero h1`: slightly smaller font, increased bottom margin for
  breathing room.

### 5. `SearchView.tsx` + `search.css`
- `.utility-view`: reduce top padding, remove landing‑page feel.
- Keep search input + grid layout; simplify card borders, remove `--sh-card`.

### 6. `PluginsView.tsx` + `marketplace.css`
- `.plugins-hero`: remove heavy marketing gradient, aurora, grain overlay.
  Replace with a subtle `--c-bg-soft` background + `--c-border-soft` border.
- `.plugins-hero-pill`, `.plugins-hero-cta`: reduce shadow, align with
  global button styles.
- `.plugins-card`: reduce hover transform, keep simple border change.

### 7. `AutomationView.tsx` + `automation.css`
- `.automation-empty-state`: reduce cloud icon size, simplify empty‑state
  presentation.
- Keep button styles aligned with `plugins-button` / global controls.

### 8. `SettingsLayout.tsx` + `settings.css`
- `.settings-card`: reduce border weight (`--c-border-soft` → `--c-border-faint`).
- `.settings-row`, `.radio-card`, `.toggle-switch`: unify border-radius (8px),
  hover states with `--c-bg-hover`.
- Settings forms and section headers: keep structure, reduce visual noise.

### 9. `shell.css` / `layout.css`
- `.desktop-main`: keep border-radius 16px but reduce border weight.
- `.app-shell`, `.desktop-frame`: quiet background colors.

## Files to Modify
1. `apps/desktop/src/renderer/styles/base.css`
2. `apps/desktop/src/renderer/styles/shell.css`
3. `apps/desktop/src/renderer/styles/controls.css`
4. `apps/desktop/src/renderer/features/session/ConversationPage.tsx`
5. `apps/desktop/src/renderer/features/session/session.css`
6. `apps/desktop/src/renderer/features/session/composer.css`
7. `apps/desktop/src/renderer/features/session/QuickChatView.tsx`
8. `apps/desktop/src/renderer/features/layout/layout.css`
9. `apps/desktop/src/renderer/features/search/search.css`
10. `apps/desktop/src/renderer/features/search/SearchView.tsx`
11. `apps/desktop/src/renderer/features/plugins/marketplace.css`
12. `apps/desktop/src/renderer/features/automation/automation.css`
13. `apps/desktop/src/renderer/features/settings/settings.css`

## Verification
- `bun run desktop:typecheck`
- `bun test apps/desktop/src/renderer/features/session/ComposerCard.test.tsx apps/desktop/src/renderer/features/session/ConversationPage.test.ts`
- Visual smoke test on `http://127.0.0.1:5000/#/quick-chat`, a history
  session, search, plugins, automation, and settings.
- Confirm workflow sidebar no longer appears.
- Confirm composer, cards, and text are readable in dark theme.
