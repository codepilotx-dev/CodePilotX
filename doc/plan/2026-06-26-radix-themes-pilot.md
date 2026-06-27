# Radix Themes 试点实施计划(模型菜单 + 侧边栏右键菜单)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pilot Radix Themes on two UI locations in the desktop renderer: (a) replace the model selection menu in `ComposerCard.tsx` with Radix Themes `DropdownMenu` (with local CSS bridging to match existing popover visuals), and (b) introduce Radix Themes `ContextMenu` for right-click actions on sidebar session rows and project rows (using stock Themes styling, no CSS overrides). Both locations wrap a local `<Theme appearance={resolvedVariant}>` to keep the rest of the app unaffected.

**Architecture:** Add `@radix-ui/themes` import to `apps/desktop/src/renderer/index.tsx` (themes CSS before local `styles.css`), add `styles/model-menu-pilot.css` for the scoped `.rm-*` overrides used only by the model menu, create a generic `SidebarContextMenu.tsx` wrapper around `@radix-ui/themes` `ContextMenu`, and wire the two sidebar call sites (`SidebarSessionGroup.tsx`, `SidebarProjectGroup.tsx`) to wrap their `SidebarRow` triggers with that wrapper. The model menu block in `ComposerCard.tsx` is rewritten from the old `PopoverMenu` + primitive `DropdownMenu.Sub` structure to `RTDropdownMenu.Root/Trigger/Content/Sub/SubTrigger/SubContent/Item` with aliased imports.

**Tech Stack:** `@radix-ui/themes` (already installed at `^3.1.6` / bun-resolved to `3.3.0`), `@radix-ui/react-dropdown-menu` (existing; still used by other popovers), React, existing `useDesktopTheme()` from `features/theme/themeContext.js`, existing CSS variable system (`--c-bg`, `--c-text`, `--c-bg-row-hover`, `--r-md`, `--sh-popover`, etc.).

## Global Constraints

- Pilot scope: only (a) the model selection menu in `ComposerCard.tsx`, and (b) sidebar session + project row right-click menus. Do not migrate other menus.
- Preserve existing `openDropdown === 'model'` state control, `onThinkingChange`, `onProviderModelChange`, and `closeDropdown()` behavior on the model menu.
- Right-click menus define their own action sets (do not reuse the existing `MoreHorizontal` `PopoverMenu` callbacks) and use stock Themes styling (no `.rcm-*` override CSS).
- Keep local CSS override capability for the model menu pilot only.
- Use `useDesktopTheme()` to pass `appearance={resolvedVariant}` to each local `Theme` wrapper.
- Run `bun run desktop:typecheck` after changes. No new automated tests unless pure logic functions are extracted.
- Keep existing code style (no added comments unless asked, `.js` extensions on imports).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `package.json` (root) | (already) | `@radix-ui/themes` already present |
| `apps/desktop/src/renderer/index.tsx` | Modify | Import `@radix-ui/themes/styles.css` before local `styles.css` |
| `apps/desktop/src/renderer/styles/model-menu-pilot.css` | Create | Scoped `.rm-*` bridge styles for the model menu only |
| `apps/desktop/src/renderer/styles.css` | Modify | Add `@import './styles/model-menu-pilot.css'` after existing imports |
| `apps/desktop/src/renderer/features/session/ComposerCard.tsx` | Modify | Replace model menu `PopoverMenu` block with Radix Themes `DropdownMenu` (alias `RTDropdownMenu`) |
| `apps/desktop/src/renderer/features/layout/sidebar/SidebarContextMenu.tsx` | Create | Generic wrapper around `@radix-ui/themes` `ContextMenu` with typed `ContextMenuAction` schema and recursive renderer |
| `apps/desktop/src/renderer/features/layout/sidebar/SidebarRow.tsx` | (no change) | `HTMLAttributes<HTMLElement>` already accepts `onContextMenu`; Themes `ContextMenu.Trigger` attaches it via Slot |
| `apps/desktop/src/renderer/features/layout/sidebar/SidebarSessionGroup.tsx` | Modify | Wire `<SidebarContextMenu>` around each session row; define independent session actions |
| `apps/desktop/src/renderer/features/layout/sidebar/SidebarProjectGroup.tsx` | Modify | Wire `<SidebarContextMenu>` around each project header row; define independent project actions |
| `doc/plan/2026-06-26-radix-themes-pilot.md` | (this file) | Replaces `2026-06-26-radix-themes-model-menu-pilot.md` |

---

## Theme 3.x API notes (differences from plan docs)

These are runtime / type quirks discovered during implementation:

1. `RTDropdownMenu.Trigger` does not accept `asChild` (it's stripped from types), but its implementation internally uses `asChild:!0` and Slot. Pass the trigger element as the **child** of `Trigger`, not via `asChild`:
   ```tsx
   <RTDropdownMenu.Trigger>
     <ChipButton ...>...</ChipButton>
   </RTDropdownMenu.Trigger>
   ```

2. `RTDropdownMenu.Content` (and `SubContent`) auto-portal. Do **not** wrap in `RTDropdownMenu.Portal`; the package does not export a `Portal` member.

3. `RTDropdownMenu.SubContent` does not accept `size` or `variant` props in this version (only primitive `SubContent` minus removed props). SubContent inherits sizing from the surrounding `Root` context.

4. The same applies to `ContextMenu.SubContent`. The `SidebarContextMenu` wrapper omits `size`/`variant` on subcontent and only sets them on the root `Content`.

---

### Task 1: Install `@radix-ui/themes` dependency

**Files:**
- (already done — `@radix-ui/themes` is in `package.json` and `node_modules`)

**Status:** Done in this branch. Verify:

- [x] **Step 1: Verify presence**

Run: `ls node_modules/@radix-ui/themes/package.json`

Expected: file exists; `"version": "3.3.0"` in the package.

---

### Task 2: Import Radix Themes CSS in renderer entry

**Files:**
- Modify: `apps/desktop/src/renderer/index.tsx`

- [x] **Step 1: Add Radix Themes CSS import before local `styles.css`**

Insert before the existing `import './styles.css'`:

```tsx
import '@radix-ui/themes/styles.css'
import './styles.css'
```

> **Note:** `apps/desktop/src/renderer/App.tsx` already imports `@radix-ui/themes/styles.css` and wraps the app in `<Theme radius="medium" ...>`. Bundlers dedupe duplicate CSS imports, so the second import is harmless. We keep the `index.tsx` import per the original plan because (a) it makes the entry point's style load order explicit, and (b) it documents the dependency at the renderer boundary.

- [x] **Step 2: Run typecheck to verify import resolves**

Run: `bun run desktop:typecheck`

Expected: PASS.

---

### Task 3: Add scoped bridge CSS for the pilot model menu

**Files:**
- Create: `apps/desktop/src/renderer/styles/model-menu-pilot.css`
- Modify: `apps/desktop/src/renderer/styles.css`

- [x] **Step 1: Create `model-menu-pilot.css`**

Create `apps/desktop/src/renderer/styles/model-menu-pilot.css` with the following scoped bridge styles. The `.rm-model-menu` wrapper limits every selector to the model menu only, so Radix Themes defaults are kept everywhere else.

```css
.rm-model-menu .rt-DropdownMenuContent {
  min-width: 270px;
  max-width: 360px;
  max-height: min(420px, calc(100vh - 96px));
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: var(--r-lg);
  background: var(--c-bg);
  border: 1px solid var(--black-a2);
  box-shadow: var(--sh-popover);
  color: var(--c-text);
  font-size: var(--fs-13);
  padding: 6px;
}

.rm-model-menu .rt-DropdownMenuSubTrigger {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--r-md);
  color: var(--c-text);
  font-size: var(--fs-13);
  line-height: 1.4;
  cursor: default;
  outline: none;
  user-select: none;
  transition: background 0.12s ease-out;
}

.rm-model-menu .rt-DropdownMenuSubTrigger:hover,
.rm-model-menu .rt-DropdownMenuSubTrigger[data-highlighted] {
  background: var(--c-bg-row-hover);
}

.rm-model-menu .rt-DropdownMenuSubTrigger[data-state="open"] {
  background: var(--c-bg-row-hover);
}

.rm-model-menu .rt-DropdownMenuSubContent {
  min-width: 220px;
  max-width: 320px;
  max-height: min(
    360px,
    var(--radix-dropdown-menu-content-available-height, calc(100vh - 96px))
  );
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: var(--r-lg);
  background: var(--c-bg);
  border: 1px solid var(--black-a2);
  box-shadow: var(--sh-popover);
  color: var(--c-text);
  font-size: var(--fs-13);
  padding: 6px;
}

.rm-model-menu .rt-DropdownMenuItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--r-md);
  color: var(--c-text);
  font-size: var(--fs-13);
  line-height: 1.4;
  cursor: default;
  outline: none;
  user-select: none;
  transition: background 0.12s ease-out;
}

.rm-model-menu .rt-DropdownMenuItem:hover,
.rm-model-menu .rt-DropdownMenuItem[data-highlighted] {
  background: var(--c-bg-row-hover);
}

.rm-model-menu .rt-DropdownMenuItem[data-disabled] {
  color: var(--c-text-disabled);
  pointer-events: none;
}

.rm-model-menu .rm-section-header {
  padding: var(--sp-2) 10px var(--sp-1);
  color: var(--c-text-meta);
  font-size: var(--fs-12);
  font-weight: 500;
}

.rm-model-menu .rm-divider {
  height: 1px;
  margin: var(--sp-1) 0;
  background: var(--c-border-row);
}

.rm-model-menu .rm-empty {
  padding: var(--sp-3) 10px;
  color: var(--c-text-placeholder);
  font-size: var(--fs-12);
  text-align: center;
}

.rm-model-menu .rm-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-model-menu .rm-item-check {
  flex-shrink: 0;
  width: var(--app-icon-size);
  height: var(--app-icon-size);
  color: var(--c-icon);
  stroke-width: var(--app-icon-stroke-width);
}

.rm-model-menu .rm-item-arrow {
  flex-shrink: 0;
  width: var(--app-icon-size);
  height: var(--app-icon-size);
  color: var(--c-icon-arrow);
}

.rm-model-menu .rm-sub-trigger-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.rm-model-menu .rm-provider-check {
  margin-left: auto;
}
```

- [x] **Step 2: Import the new CSS in `styles.css`**

Append at the end of `apps/desktop/src/renderer/styles.css`:

```css
@import './styles/model-menu-pilot.css';
```

- [x] **Step 3: Run typecheck**

Run: `bun run desktop:typecheck`

Expected: PASS.

---

### Task 4: Replace model menu with Radix Themes `DropdownMenu` in `ComposerCard.tsx`

**Files:**
- Modify: `apps/desktop/src/renderer/features/session/ComposerCard.tsx`

- [x] **Step 1: Add new imports at the top**

After the existing `import * as DropdownMenu from '@radix-ui/react-dropdown-menu'`:

```tsx
import { Theme, DropdownMenu as RTDropdownMenu } from '@radix-ui/themes'
```

After the existing imports (near other component imports), add:

```tsx
import { useDesktopTheme } from '../theme/themeContext.js'
```

- [x] **Step 2: Add `useDesktopTheme()` call inside the component**

Right after the `useState` declarations (after `const [branchSearch, setBranchSearch] = useState('')`):

```tsx
const { resolvedVariant } = useDesktopTheme()
```

- [x] **Step 3: Replace the model `PopoverMenu` block**

Replace the entire `<PopoverMenu className="popover-model" ...>...</PopoverMenu>` block with the Radix Themes version. The replacement uses `<Theme appearance={resolvedVariant}>` wrapper, `<RTDropdownMenu.Trigger>` accepting the `ChipButton` as child (no `asChild`), and `<RTDropdownMenu.Content>` directly (no manual `Portal`). The thinking-mode / provider / submenu structure mirrors the original.

- [x] **Step 4: Run typecheck**

Run: `bun run desktop:typecheck`

Expected: PASS.

---

### Task 5: Final validation for the model menu

- [x] **Step 1: Run full typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 2: Manual smoke test**

Run the desktop app (`bun run desktop:dev`) and verify:
- Model menu opens when clicking the model chip button.
- Thinking mode options (if applicable) toggle correctly.
- Provider sub-menus expand on hover.
- Selecting a model closes the menu and updates the displayed model.
- Empty state ("未配置模型") renders when no providers are configured.
- Theme switching (light/dark/system) correctly affects the menu appearance.

---

### Task 6: Create `SidebarContextMenu.tsx` wrapper

**Files:**
- Create: `apps/desktop/src/renderer/features/layout/sidebar/SidebarContextMenu.tsx`

- [x] **Step 1: Create the component**

```tsx
import type { ReactNode } from 'react'
import { ContextMenu, Theme } from '@radix-ui/themes'
import { useDesktopTheme } from '../../theme/themeContext.js'

export type ContextMenuItemColor = 'red' | 'gray' | 'amber'

export type ContextMenuAction =
  | {
      kind: 'item'
      label: string
      icon?: ReactNode
      shortcut?: string
      color?: ContextMenuItemColor
      disabled?: boolean
      onSelect: () => void
    }
  | { kind: 'separator' }
  | {
      kind: 'sub'
      label: string
      icon?: ReactNode
      children: ContextMenuAction[]
    }

type Props = {
  trigger: ReactNode
  actions: ContextMenuAction[]
  size?: '1' | '2'
  variant?: 'solid' | 'soft'
}

export function SidebarContextMenu({
  trigger,
  actions,
  size = '1',
  variant = 'soft',
}: Props): ReactNode {
  const { resolvedVariant } = useDesktopTheme()
  return (
    <Theme appearance={resolvedVariant}>
      <ContextMenu.Root>
        <ContextMenu.Trigger>{trigger}</ContextMenu.Trigger>
        <ContextMenu.Content size={size} variant={variant}>
          {actions.map((action, index) => renderAction(action, index))}
        </ContextMenu.Content>
      </ContextMenu.Root>
    </Theme>
  )
}

function renderAction(action: ContextMenuAction, key: number): ReactNode {
  switch (action.kind) {
    case 'separator':
      return <ContextMenu.Separator key={key} />
    case 'sub':
      return (
        <ContextMenu.Sub key={key}>
          <ContextMenu.SubTrigger>
            {action.icon}
            {action.label}
          </ContextMenu.SubTrigger>
          <ContextMenu.SubContent>
            {action.children.map((child, childKey) =>
              renderAction(child, childKey),
            )}
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
      )
    case 'item':
      return (
        <ContextMenu.Item
          key={key}
          color={action.color}
          shortcut={action.shortcut}
          disabled={action.disabled}
          onSelect={action.onSelect}
        >
          {action.icon}
          {action.label}
        </ContextMenu.Item>
      )
  }
}
```

Key design notes:
- `trigger` is a single React element (SidebarRow) — required by Themes `ContextMenu.Trigger` internals (`requireReactElement`).
- The wrapper handles `Theme` (local light/dark variant), `Root`, `Trigger`, and `Content`. Callers only pass trigger + actions.
- No CSS overrides — the right-click menu uses Radix Themes defaults for this pilot (chosen to compare against the model menu's bridged styling).

- [x] **Step 2: Run typecheck**

Run: `bun run desktop:typecheck`

Expected: PASS.

---

### Task 7: Verify `SidebarRow.tsx` needs no changes

**Files:**
- (no change) `apps/desktop/src/renderer/features/layout/sidebar/SidebarRow.tsx`

- [x] **Step 1: Confirm `onContextMenu` is already accepted**

`Props = HTMLAttributes<HTMLElement> & { ... }` already includes `onContextMenu`. Themes `ContextMenu.Trigger` uses Slot to clone the child and attach the handler, so the right-click handler is forwarded to the `<div>` / `<li>` element rendered by `SidebarRow` via `...rowProps`. No code change needed.

---

### Task 8: Wire right-click menu into `SidebarSessionGroup.tsx`

**Files:**
- Modify: `apps/desktop/src/renderer/features/layout/sidebar/SidebarSessionGroup.tsx`

- [x] **Step 1: Add imports**

Add to the lucide-react import: `Copy`, `Pencil`. Add at the bottom of the imports:

```tsx
import {
  SidebarContextMenu,
  type ContextMenuAction,
} from "./SidebarContextMenu.js";
```

- [x] **Step 2: Add `getSessionContextMenuActions(session)` helper**

Inside the component, before `renderSessionRow`:

```tsx
function getSessionContextMenuActions(
  session: SessionListItem,
): ContextMenuAction[] {
  return [
    {
      kind: 'item',
      label: '重命名',
      icon: <Pencil size={APP_ICON_SIZE} />,
      onSelect: () => {
        // TODO: replace with onRenameSession when it exists
        // eslint-disable-next-line no-console
        console.log('[TODO] rename session', session.id)
      },
    },
    {
      kind: 'item',
      label: '复制会话 ID',
      icon: <Copy size={APP_ICON_SIZE} />,
      onSelect: () => {
        void navigator.clipboard.writeText(session.id)
      },
    },
    { kind: 'separator' },
    session.pinnedAt
      ? {
          kind: 'item' as const,
          label: '取消置顶',
          icon: <PinOff size={APP_ICON_SIZE} />,
          onSelect: () => onUnpinSession(session),
        }
      : {
          kind: 'item' as const,
          label: '置顶',
          icon: <Pin size={APP_ICON_SIZE} />,
          onSelect: () => onPinSession(session),
        },
    {
      kind: 'item',
      label: '归档',
      icon: <Archive size={APP_ICON_SIZE} />,
      onSelect: () => onArchiveSession(session),
    },
  ]
}
```

- [x] **Step 3: Wrap each session row with `SidebarContextMenu`**

In `renderSessionRow`, capture the existing `<SidebarRow ...>...</SidebarRow>` into a local `row` variable and return `<SidebarContextMenu trigger={row} actions={...} key={session.id} />` instead.

> **Note on `key`:** the wrapped `<SidebarContextMenu>` should carry the key (React reconciles at the wrapper level). The redundant `key={session.id}` on the inner `SidebarRow` is harmless — React strips `key` from props before passing to the DOM.

- [x] **Step 4: Run typecheck**

Run: `bun run desktop:typecheck`

Expected: PASS.

---

### Task 9: Wire right-click menu into `SidebarProjectGroup.tsx`

**Files:**
- Modify: `apps/desktop/src/renderer/features/layout/sidebar/SidebarProjectGroup.tsx`

- [x] **Step 1: Add imports**

Add at the bottom of the imports:

```tsx
import {
  SidebarContextMenu,
  type ContextMenuAction,
} from "./SidebarContextMenu.js";
```

- [x] **Step 2: Add `getProjectContextMenuActions()` helper**

Inside the component, before the `return`:

```tsx
function getProjectContextMenuActions(): ContextMenuAction[] {
  return [
    {
      kind: 'item',
      label: '在资源管理器中打开',
      icon: <FolderOpen size={APP_ICON_SIZE} />,
      onSelect: () => {
        void desktopClient.openPathWithDefaultTarget(project.path)
      },
    },
    {
      kind: 'item',
      label: '重命名项目',
      icon: <Pencil size={APP_ICON_SIZE} />,
      onSelect: () => {
        // TODO: replace with onRenameProject when it exists
        // eslint-disable-next-line no-console
        console.log('[TODO] rename project', project.path)
      },
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '归档所有对话',
      icon: <Archive size={APP_ICON_SIZE} />,
      disabled: projectSessions.length === 0,
      onSelect: () => {
        projectSessions.forEach((session) => onArchiveSession(session))
      },
    },
    {
      kind: 'item',
      label: '移除',
      icon: <X size={APP_ICON_SIZE} />,
      color: 'red',
      onSelect: () => onRemoveWorkspace(project),
    },
  ]
}
```

- [x] **Step 3: Wrap the project header row with `SidebarContextMenu`**

Replace the top-level `<SidebarRow>...</SidebarRow>` (the project header) so it's the `trigger` of a new `<SidebarContextMenu actions={...} trigger={...} />`. The existing trailing `PopoverMenu` (MoreHorizontal button) stays untouched inside the row.

- [x] **Step 4: Run typecheck**

Run: `bun run desktop:typecheck`

Expected: PASS.

---

### Task 10: Final right-click menu validation

- [x] **Step 1: Run full typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 2: Manual smoke test for right-click menus**

Run the desktop app (`bun run desktop:dev`) and verify:
- Right-clicking a session row in the sidebar opens the context menu with the expected items.
- Right-clicking a project header row opens its context menu.
- "置顶" / "取消置顶" toggles correctly.
- "归档" closes the menu and triggers the callback.
- "归档所有对话" is disabled when the project has no sessions.
- "移除" renders in the destructive color.
- Light/dark theme switching applies correctly to the context menu.
- `Esc` closes the menu.

---

### Task 11: Cross-feature regression check

- [x] **Step 1: Run full typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 2: Verify no regressions in other menus**

Manually confirm:
- Model menu (now on Radix Themes) opens, navigates submenus, selects items, respects theme.
- Project `MoreHorizontal` popover (unchanged) still works.
- Composer permission selector, branch selector, mode selector, context dropdown all unchanged and functional.
- Other popovers across the app (search, review, settings) render normally.

- [ ] **Step 3: Verify CSS cascade is not broken**

Confirm:
- Local `.popover-*` styles still apply to non-model popovers.
- `.rm-*` overrides only apply to the model menu (scoped via `.rm-model-menu`).
- Right-click menu uses stock Themes styling — visually distinct from the model menu (intentional, to compare both styles during pilot review).
- Theme switching (light/dark) correctly affects all three: model menu, right-click menu, and unchanged popovers.

---

## Design Decisions

1. **Different visual strategies for the two pilots:** the model menu uses local `.rm-*` bridge CSS to match existing popover visuals (avoids jarring change), while the right-click menus use Radix Themes defaults (no overrides). This lets the pilot team compare both strategies in one cycle and decide the rollout style.

2. **`SidebarContextMenu` is generic, not sidebar-specific:** the wrapper is parameterized on a `trigger` + `actions` shape so it can be reused if more right-click surfaces are added later (e.g. workspace items in `ProjectList.tsx`).

3. **Independent action sets for right-click menus:** the right-click items are intentionally a curated subset of what the `MoreHorizontal` popover offers. They do not call into the same handlers — when a project/session is renamed via the right-click menu in the future, it should be a dedicated flow, not a re-use of the popover's no-op callback.

4. **Renames are placeholder `console.log`:** the project currently exposes no `onRenameSession` / `onRenameProject` callbacks. The right-click items are wired to log a `[TODO] rename ...` line so the actions are observable in DevTools. Replace with real handlers when the rename IPC arrives.

5. **No delete action on session right-click:** the desktop app currently has no session-delete API, only archive. The right-click menu follows that — archive is the destructive-grade option; remove is reserved for projects (where `onRemoveWorkspace` exists).

6. **Aliased import (`RTDropdownMenu`)** in `ComposerCard.tsx`: the file still imports primitive `@radix-ui/react-dropdown-menu` as `DropdownMenu` for the context menu's `renderContextSwitchItem`. Aliasing avoids naming collisions during the pilot.

7. **No `Portal` wrapper around Radix Themes Content:** in `@radix-ui/themes` 3.x, `DropdownMenu.Content` and `ContextMenu.Content` portal internally. The package does not export a `Portal` member, and writing one manually breaks the type contract.

8. **No `asChild` on `RTDropdownMenu.Trigger`:** the type definitions strip `asChild`, but the implementation always uses `asChild:!0` with Slot. The trigger element is the **child** of `<Trigger>`, not a prop. The implementation accepts this; the types just don't document it.

9. **`Theme` wrapper local to each pilot:** each new component (model menu, context menu) wraps its own `<Theme appearance={resolvedVariant}>`. The global `<Theme>` in `App.tsx` provides base tokens without `appearance`, which is correct — it doesn't fight our local variant overrides.

10. **No `SidebarRow` modification:** Themes `ContextMenu.Trigger` uses Slot to forward `onContextMenu` onto its child's DOM. Since `SidebarRow` already accepts arbitrary HTML attributes via `HTMLAttributes<HTMLElement>` and spreads them onto its root `<li>`/`<div>`, no prop plumbing change is needed.

---

## Future Work (out of scope for this pilot)

- Real `onRenameSession` / `onRenameProject` flows.
- Workspace item right-click menus in `ProjectList.tsx` (currently uses simple `<button>` rows).
- Submenu usage on the right-click menus (the wrapper already supports `kind: 'sub'`, but no pilot surface needs it yet).
- If the bridged `.rm-*` model menu style is approved, the same bridge CSS could be applied to the right-click menus by giving `SidebarContextMenu` a `className` prop.
- Theme Tokens migration for `App.tsx`'s global `<Theme>` to use `appearance={resolvedVariant}`.
