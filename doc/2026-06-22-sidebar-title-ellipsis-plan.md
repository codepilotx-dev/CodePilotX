# Sidebar Title Ellipsis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or execute this single CSS bug fix inline with a red-green verification cycle. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure long sidebar project/session titles truncate with an ellipsis instead of overlapping the right-side time or action icons.

**Architecture:** The sidebar rows are rendered by `SidebarProjectGroup.tsx` and `SidebarSessionGroup.tsx`, with layout controlled by `apps/desktop/src/renderer/styles/sidebar.css`. The first fix added shrink boundaries to title spans and buttons, but the screenshot still shows the session row letting the title and time compete in a single flex line. Fix the row boundary by making session rows a two-column grid: `minmax(0, 1fr)` for the title button and a fixed metadata column for time/actions.

**Tech Stack:** CSS, TypeScript test with Bun, Node `fs`.

## Global Constraints

- Read and write files as UTF-8.
- Save the plan in `doc` before modifying code.
- Keep edits local to sidebar styling and its regression test.
- Do not revert unrelated dirty working tree changes.
- Preserve existing sidebar behavior and labels.
- Desktop-only behavior is sufficient.

---

## File Structure

- Modify: `apps/desktop/src/renderer/styles/sidebar.css`
  - Add shrink boundaries for sidebar text labels and row buttons.
  - Replace fragile session/project button width math with flex sizing.
  - Make session rows a grid with a shrinkable title column and fixed metadata column.
- Create: `apps/desktop/src/renderer/styles/sidebar.test.ts`
  - Read `sidebar.css` and assert the flex/ellipsis rules required for long titles.
  - Assert that session rows reserve a fixed metadata column with `grid-template-columns: minmax(0, 1fr) 50px`.

## Task 1: Fix Sidebar Title Truncation

**Files:**
- Create: `apps/desktop/src/renderer/styles/sidebar.test.ts`
- Modify: `apps/desktop/src/renderer/styles/sidebar.css`

**Interfaces:**
- Consumes: existing CSS class names `.sidebar-project-button`, `.sidebar-session-button`, `.sidebar-project-name`, `.sidebar-session-title`, `.sidebar-item-label`, `.sidebar-settings-link span:last-child`.
- Produces: CSS rules that allow long sidebar labels to shrink and display ellipsis.
- Produces: session rows with stable two-column layout so title text cannot overlap the timestamp/action column.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/styles/sidebar.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const sidebarCss = readFileSync(
  new URL('./sidebar.css', import.meta.url),
  'utf8',
)

test('sidebar title flex items can shrink before applying ellipsis', () => {
  expect(sidebarCss).toMatch(
    /\.sidebar-item-label,[\s\S]*\.sidebar-session-title,[\s\S]*min-width:\s*0;/,
  )
  expect(sidebarCss).toMatch(
    /\.sidebar-project-button,[\s\S]*\.sidebar-session-button\s*\{[\s\S]*flex:\s*1\s+1\s+auto;[\s\S]*min-width:\s*0;/,
  )
})

test('sidebar session rows reserve a fixed metadata column', () => {
  const rowBlock = cssBlockFor('.sidebar-session-row')

  expect(rowBlock).toContain('display: grid;')
  expect(rowBlock).toContain('grid-template-columns: minmax(0, 1fr) 50px;')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
bun test apps/desktop/src/renderer/styles/sidebar.test.ts
```

Expected: FAIL because the current sidebar CSS does not declare the two-column grid layout for `.sidebar-session-row`.

- [ ] **Step 3: Apply the CSS fix**

In `apps/desktop/src/renderer/styles/sidebar.css`:

```css
.sidebar-item-label,
.sidebar-project-name,
.sidebar-session-title,
.sidebar-section-title,
.sidebar-settings-link span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Update the shared button rule:

```css
.sidebar-project-button,
.sidebar-session-button {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: var(--sidebar-item-gap);
  padding: 0;
  color: inherit;
  text-align: left;
}
```

Update the session row rule:

```css
.sidebar-session-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 50px;
  justify-content: stretch;
  padding-left: 30px;
}
```

- [ ] **Step 4: Run focused verification**

Run:

```powershell
bun test apps/desktop/src/renderer/styles/sidebar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing nearby sidebar tests**

Run:

```powershell
bun test apps/desktop/src/renderer/components/sidebar/SidebarSessionGroup.test.ts apps/desktop/src/renderer/styles/sidebar.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run desktop typecheck**

Run:

```powershell
bun run desktop:typecheck
```

Expected: exit code 0 unless blocked by existing unrelated working-tree errors. If blocked, record the exact unrelated error.

- [ ] **Step 7: Review changed files**

Run:

```powershell
git diff -- apps/desktop/src/renderer/styles/sidebar.css apps/desktop/src/renderer/styles/sidebar.test.ts doc/2026-06-22-sidebar-title-ellipsis-plan.md
```

Expected: diff only includes the plan, focused CSS test, and sidebar truncation CSS.

## Self-Review

- Spec coverage: The plan fixes long project/session sidebar titles and protects the behavior with a focused regression test.
- Placeholder scan: No placeholders remain.
- Type consistency: Class names match the current sidebar CSS and component markup.
