# Window Restore Button Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or execute this single task inline with a fresh red-green verification cycle. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror only the maximized-state restore icon inside the desktop window control button.

**Architecture:** The window controls are rendered by `apps/desktop/src/renderer/components/MenuBar.tsx`, while their visual styling is in `apps/desktop/src/renderer/styles/chrome.css`. Keep the click behavior and accessible labels unchanged, add a restore-icon-specific class to the `Copy` icon, and apply a horizontal CSS transform to that class.

**Tech Stack:** React, TypeScript/TSX, lucide-react icons, CSS, Bun test runner.

## Global Constraints

- Read and write files as UTF-8.
- Keep `.js` import suffix style when adding imports.
- Keep edits local to the desktop menu bar and chrome styling.
- Do not touch generated files.
- Preserve existing window control behavior and public props.
- The app only needs desktop page behavior for this change.

---

## File Structure

- Modify: `apps/desktop/src/renderer/components/MenuBar.tsx`
  - Add a dedicated class to the restore-state `Copy` icon only.
- Modify: `apps/desktop/src/renderer/styles/chrome.css`
  - Add the horizontal mirror transform for that icon class.
- Create: `apps/desktop/src/renderer/components/MenuBar.test.tsx`
  - Render the menu bar in maximized and non-maximized states to verify that only the restore icon receives the mirror class.

## Task 1: Mirror Restore Icon

**Files:**
- Create: `apps/desktop/src/renderer/components/MenuBar.test.tsx`
- Modify: `apps/desktop/src/renderer/components/MenuBar.tsx`
- Modify: `apps/desktop/src/renderer/styles/chrome.css`

**Interfaces:**
- Consumes: `MenuBar` props, including `isMaximized`.
- Produces: class name `window-restore-icon` on the restore-state `Copy` SVG.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/components/MenuBar.test.tsx` with a server-rendered component test:

```tsx
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MenuBar } from './MenuBar.js'

const noop = () => {}

function renderMenuBar(isMaximized: boolean): string {
  return renderToStaticMarkup(
    <MenuBar
      sidebarCollapsed={false}
      isMaximized={isMaximized}
      onToggleSidebar={noop}
      onMinimize={noop}
      onToggleMaximize={noop}
      onClose={noop}
      onFileMenuAction={noop}
      onEditMenuAction={noop}
      onViewMenuAction={noop}
      onWindowMenuAction={noop}
      onHelpMenuAction={noop}
    />,
  )
}

test('restore window control icon is mirrored only when maximized', () => {
  expect(renderMenuBar(true)).toContain('window-restore-icon')
  expect(renderMenuBar(false)).not.toContain('window-restore-icon')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
bun test apps/desktop/src/renderer/components/MenuBar.test.tsx
```

Expected: FAIL because the rendered maximized-state restore icon does not yet include `window-restore-icon`.

- [ ] **Step 3: Add the restore icon class**

In `apps/desktop/src/renderer/components/MenuBar.tsx`, change only the maximized-state `Copy` icon:

```tsx
<Copy
  className="window-restore-icon"
  size={APP_ICON_SIZE}
  strokeWidth={APP_ICON_STROKE_WIDTH}
/>
```

- [ ] **Step 4: Mirror the class in CSS**

In `apps/desktop/src/renderer/styles/chrome.css`, add:

```css
.window-restore-icon {
  transform: scaleX(-1);
}
```

- [ ] **Step 5: Run focused verification**

Run:

```powershell
bun test apps/desktop/src/renderer/components/MenuBar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run desktop typecheck**

Run:

```powershell
bun run desktop:typecheck
```

Expected: exit code 0.

- [ ] **Step 7: Review changed files**

Run:

```powershell
git diff -- apps/desktop/src/renderer/components/MenuBar.tsx apps/desktop/src/renderer/styles/chrome.css apps/desktop/src/renderer/components/MenuBar.test.tsx doc/2026-06-22-window-restore-button-mirror-plan.md
```

Expected: diff only includes the plan, focused test, restore icon class, and CSS transform.

## Self-Review

- Spec coverage: The plan mirrors only the restore icon, preserves behavior, and scopes the change to desktop renderer files.
- Placeholder scan: No placeholders remain.
- Type consistency: The class name is consistently `window-restore-icon` in TSX, CSS, and the test.
