# Desktop ChatGPT-Style UI Refactoring — Implementation Plan

> **For agentic workers:** Inline execution preferred.

**Goal:** Refactor desktop renderer UI to ChatGPT-inspired visual system (quiet white, soft borders, center chat, reduced card noise) while removing WorkflowNodeSidebar from conversation page.

**Architecture:** Pure CSS token overrides + targeted TSX/component changes. No data flow, IPC, or shared type modifications.

**Tech Stack:** CSS custom properties, React/TSX, Radix UI, lucide-react.

## Global Constraints
- No business data flow, IPC, session state, message submission changes.
- No permission approval logic modifications.
- No route, URL, or shared type changes.
- Light theme = primary target; dark theme = smoke test only.
- Keep `.js` extensions in imports.
- Keep lucide icon system; no emoji as structural icons.

---

### Task 1: `base.css` — ChatGPT visual tokens
**Files:** `apps/desktop/src/renderer/styles/base.css`
- Soften `--c-bg` to `#ffffff`, add `--c-bg-pure` if needed.
- Reduce `--sh-card` / `--sh-card-lg` shadow weight.
- Ensure `--c-border` uses gray-4 for light, gray-6 for dark.
- Add `--radius-*` tokens if missing (already present via Radix).
- Keep MiSans font stack, composer width 760px.

### Task 2: `ConversationPage.tsx` — Remove WorkflowNodeSidebar
**Files:** `apps/desktop/src/renderer/features/session/ConversationPage.tsx`
- Remove `<WorkflowNodeSidebar nodes={workflowNodes} />` JSX (line 679).
- Remove `WorkflowNodeSidebar` function component (lines 1234–1286).
- Keep `workflowNodes`, `buildWorkflowNodes`, derivations for reuse.

### Task 3: `session.css` — Remove workflow sidebar CSS
**Files:** `apps/desktop/src/renderer/features/session/session.css`
- Remove `.workflow-page__sidebar`, `.workflow-page__timeline`, `.workflow-node*`, `.workflow-page__sidebar-title` blocks (lines 2331–2477).
- Keep `.app-shell.menubar-debug-mode .workflow-page__sidebar` in layout.css (unrelated).
- Adjust `.workflow-page__scroll` padding (reduce top).
- Reduce `.workflow-page__composer-inner` shadow weight.

### Task 4: `QuickChatView.tsx` + `session.css` hero
**Files:** `apps/desktop/src/renderer/features/session/QuickChatView.tsx`, `session.css`
- Reduce `.quick-chat-view` hero gap from 45px → 32px.
- Adjust `.quick-chat-hero h1` size slightly.

### Task 5: `shell.css` / `layout.css` — Quiet borders
**Files:** `apps/desktop/src/renderer/styles/shell.css`, `apps/desktop/src/renderer/features/layout/layout.css`
- Reduce `.desktop-main` border weight.

### Task 6: `search.css` — Reduce landing page feel
**Files:** `apps/desktop/src/renderer/features/search/search.css`
- Reduce `.utility-view` top padding.
- Remove `--sh-card` from `.utility-card`.

### Task 7: `marketplace.css` — Remove heavy marketing gradient
**Files:** `apps/desktop/src/renderer/features/plugins/marketplace.css`
- Remove `.plugins-hero-aurora`, `.plugins-hero-grain` gradient backgrounds.
- Replace with subtle `--c-bg-soft` + border.
- Reduce `.plugins-hero-pill` / `.plugins-hero-cta` shadow.
- Remove `.plugins-card` hover transform.

### Task 8: `automation.css` — Restrain empty state
**Files:** `apps/desktop/src/renderer/features/automation/automation.css`
- Reduce `.automation-cloud` size (200×140 → 120×84).
- Simplify `.automation-empty-state` presentation.

### Task 9: `settings.css` — Unify styles
**Files:** `apps/desktop/src/renderer/features/settings/settings.css`
- Reduce `.settings-card` border to `--c-border-faint`.
- Unify border-radius across rows, radio cards, switches.
- Ensure hover states use `--c-bg-hover`.

### Task 10: Typecheck + smoke test
- `bun run desktop:typecheck`
- `bun test apps/desktop/src/renderer/features/session/ComposerCard.test.tsx apps/desktop/src/renderer/features/session/ConversationPage.test.ts`
