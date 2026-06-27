# Radix Themes Model Menu Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pilot Radix Themes on the model selection menu in ComposerCard.tsx, replacing the current PopoverMenu + primitive DropdownMenu structure with Radix Themes `DropdownMenu` while keeping all existing behavior intact.

**Architecture:** Install `@radix-ui/themes`, import its CSS before local styles, wrap the model menu in a local Radix Themes `Theme` component driven by `useDesktopTheme().resolvedVariant`, and swap the PopoverMenu/DropdownMenu primitives for Radix Themes `DropdownMenu.Root/Trigger/Content/Sub/Item`. All other menus (context, permission, mode, branch) remain untouched.

**Tech Stack:** `@radix-ui/themes`, `@radix-ui/react-dropdown-menu` (existing, reused by Themes internally), React, existing CSS variable system.

## Global Constraints

- Pilot scope: only the model selection menu in `ComposerCard.tsx`. Do not migrate other menus.
- Preserve existing `openDropdown === 'model'` state control, `onThinkingChange`, `onProviderModelChange`, and `closeDropdown()` behavior.
- No global Radix Themes design system migration. No new design tokens.
- Keep local CSS override capability: Radix Themes CSS must be imported before local `styles.css`.
- Use `useDesktopTheme()` to pass `appearance={resolvedVariant}` to the local `Theme` wrapper.
- Run `bun run desktop:typecheck` after changes. No new automated tests unless pure logic functions are extracted.
- Keep existing code style (no added comments unless asked).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `package.json` (root) | Modify | Add `@radix-ui/themes` dependency |
| `apps/desktop/src/renderer/index.tsx` | Modify | Import `@radix-ui/themes/styles.css` before local styles |
| `apps/desktop/src/renderer/styles/model-menu-pilot.css` | Create | Scoped bridge styles for the pilot menu |
| `apps/desktop/src/renderer/styles.css` | Modify | Add `@import './styles/model-menu-pilot.css'` after existing imports |
| `apps/desktop/src/renderer/components/ComposerCard.tsx` | Modify | Replace model menu PopoverMenu block with Radix Themes DropdownMenu |

---

### Task 1: Install `@radix-ui/themes` dependency

**Files:**
- Modify: `package.json` (root workspace)

**Interfaces:**
- Consumes: nothing
- Produces: `@radix-ui/themes` available in `node_modules`

- [ ] **Step 1: Add `@radix-ui/themes` to root package.json dependencies**

In `package.json` at the workspace root, add to `dependencies`:

```json
"@radix-ui/themes": "^3.2.1",
```

Place it near the other `@radix-ui/*` entries (after `@radix-ui/colors`, before `@radix-ui/react-dialog`).

- [ ] **Step 2: Install dependencies**

Run: `bun install`

Expected: `bun.lock` updates, `node_modules/@radix-ui/themes` directory appears.

- [ ] **Step 3: Verify the package is resolvable**

Run: `ls node_modules/@radix-ui/themes/package.json`

Expected: file exists.

---

### Task 2: Import Radix Themes CSS in renderer entry

**Files:**
- Modify: `apps/desktop/src/renderer/index.tsx`

**Interfaces:**
- Consumes: `@radix-ui/themes` package installed in Task 1
- Produces: Radix Themes base styles loaded before local CSS

- [ ] **Step 1: Add Radix Themes CSS import before local styles.css**

In `apps/desktop/src/renderer/index.tsx`, add the import **before** the existing `import './styles.css'`:

```tsx
import '@radix-ui/themes/styles.css'
import './styles.css'
```

The file becomes:

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import '@radix-ui/themes/styles.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 2: Run typecheck to verify import resolves**

Run: `bun run desktop:typecheck`

Expected: PASS (no type errors from the import).

---

### Task 3: Add scoped bridge CSS for the pilot model menu

**Files:**
- Create: `apps/desktop/src/renderer/styles/model-menu-pilot.css`
- Modify: `apps/desktop/src/renderer/styles.css`

**Interfaces:**
- Consumes: Radix Themes CSS loaded in Task 2, existing CSS variable system
- Produces: Scoped `.rm-*` classes for the Radix Themes model menu pilot

- [ ] **Step 1: Create `model-menu-pilot.css` with scoped bridge styles**

Create `apps/desktop/src/renderer/styles/model-menu-pilot.css` with:

```css
/* Radix Themes model menu pilot — scoped bridge styles.
   Only targets the model selection menu in ComposerCard. */

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

- [ ] **Step 2: Import the new CSS in styles.css**

In `apps/desktop/src/renderer/styles.css`, add after the last existing import (line 32):

```css
@import './styles/model-menu-pilot.css';
```

The file becomes (last two lines):

```css
@import './styles/settings.css';
@import './styles/marketplace.css';
@import './styles/model-menu-pilot.css';
```

- [ ] **Step 3: Run typecheck**

Run: `bun run desktop:typecheck`

Expected: PASS.

---

### Task 4: Replace model menu with Radix Themes DropdownMenu in ComposerCard.tsx

**Files:**
- Modify: `apps/desktop/src/renderer/components/ComposerCard.tsx`

**Interfaces:**
- Consumes: `useDesktopTheme()` from `../features/theme/themeContext.js`, Radix Themes `Theme` + `DropdownMenu` from `@radix-ui/themes`, CSS classes from Task 3
- Produces: Updated model menu rendered with Radix Themes, all existing props/callbacks preserved

- [ ] **Step 1: Add new imports at the top of ComposerCard.tsx**

Add these imports after the existing `import * as DropdownMenu from '@radix-ui/react-dropdown-menu'`:

```tsx
import { Theme, DropdownMenu as RTDropdownMenu } from '@radix-ui/themes'
import { useDesktopTheme } from '../features/theme/themeContext.js'
```

Note: `RTDropdownMenu` is aliased to avoid conflict with the existing `DropdownMenu` import used by other parts of the file (context menu's `renderContextSwitchItem`).

- [ ] **Step 2: Add `useDesktopTheme()` call inside the component**

Inside the `ComposerCard` function body, after the existing `useState` declarations (around line 241), add:

```tsx
const { resolvedVariant } = useDesktopTheme()
```

- [ ] **Step 3: Replace the model PopoverMenu block (lines 739-923) with Radix Themes DropdownMenu**

Replace the entire `<PopoverMenu className="popover-model" ...>` block (lines 739-923) with the following. The old block starts at line 739 (`<PopoverMenu`) and ends at line 923 (`</PopoverMenu>`).

New code:

```tsx
<Theme appearance={resolvedVariant}>
  <RTDropdownMenu.Root
    open={openDropdown === 'model'}
    onOpenChange={open => setOpenDropdown(open ? 'model' : null)}
  >
    <RTDropdownMenu.Trigger asChild>
      <ChipButton
        active={openDropdown === 'model'}
        className="subtle"
        title={
          `${selectedProvider?.displayName ?? '模型'} · ${selectedModelTitle}`
        }
      >
        <span>
          {selectedProvider?.displayName
            ? `${selectedProvider.displayName} · `
            : ''}
          {selectedModelLabel}
          {showThinkingOptions
            ? ` · ${selectedThinkingLabel}`
            : ''}
        </span>
      </ChipButton>
    </RTDropdownMenu.Trigger>
    <RTDropdownMenu.Portal>
      <RTDropdownMenu.Content
        className="rm-model-menu"
        align="end"
        side="top"
        sideOffset={6}
      >
        {showThinkingOptions ? (
          deepSeekThinkingControls ? (
            <>
              <div className="rm-section-header">思考模式</div>
              <RTDropdownMenu.Item
                onSelect={() => {
                  onThinkingChange('default')
                }}
              >
                <span className="rm-item-label">启用</span>
                {thinkingMode !== 'disabled' ? (
                  <Check className="rm-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                ) : null}
              </RTDropdownMenu.Item>
              <RTDropdownMenu.Item
                onSelect={() => {
                  onThinkingChange('disabled')
                  closeDropdown()
                }}
              >
                <span className="rm-item-label">禁用</span>
                {thinkingMode === 'disabled' ? (
                  <Check className="rm-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                ) : null}
              </RTDropdownMenu.Item>
              {thinkingMode !== 'disabled' ? (
                <>
                  <div className="rm-divider" />
                  <div className="rm-section-header">推理强度</div>
                  <RTDropdownMenu.Item
                    onSelect={() => {
                      onThinkingChange('default')
                      closeDropdown()
                    }}
                  >
                    <span className="rm-item-label">高</span>
                    {thinkingMode !== 'enabled' ? (
                      <Check className="rm-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    ) : null}
                  </RTDropdownMenu.Item>
                  <RTDropdownMenu.Item
                    onSelect={() => {
                      onThinkingChange('enabled')
                      closeDropdown()
                    }}
                  >
                    <span className="rm-item-label">超高</span>
                    {thinkingMode === 'enabled' ? (
                      <Check className="rm-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    ) : null}
                  </RTDropdownMenu.Item>
                </>
              ) : null}
              <div className="rm-divider" />
            </>
          ) : (
            <>
              <div className="rm-section-header">推理</div>
              {thinkingOptions.map(option => (
                <RTDropdownMenu.Item
                  key={option.value}
                  onSelect={() => {
                    onThinkingChange(option.value)
                    closeDropdown()
                  }}
                >
                  <span className="rm-item-label">{option.label}</span>
                  {option.value === thinkingMode ? (
                    <Check className="rm-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  ) : null}
                </RTDropdownMenu.Item>
              ))}
              <div className="rm-divider" />
            </>
          )
        ) : null}
        <div className="rm-section-header">提供商</div>
        {providerOptions.length === 0 ? (
          <div className="rm-empty">未配置模型</div>
        ) : null}
        {providerOptions.map(provider => (
          <RTDropdownMenu.Sub key={provider.providerID}>
            <RTDropdownMenu.SubTrigger
              className={provider.providerID === selectedProviderID ? 'selected' : ''}
            >
              <span className="rm-sub-trigger-content">
                <span className="rm-item-label">{provider.displayName}</span>
                {provider.providerID === selectedProviderID ? (
                  <Check className="rm-item-check rm-provider-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                ) : null}
              </span>
              <ChevronRight className="rm-item-arrow" size={APP_ICON_SIZE} />
            </RTDropdownMenu.SubTrigger>
            <RTDropdownMenu.Portal>
              <RTDropdownMenu.SubContent
                className="rm-model-menu"
                alignOffset={-6}
                sideOffset={8}
              >
                <div className="rm-section-header">模型</div>
                {provider.modelPresets.map(preset => (
                  <RTDropdownMenu.Item
                    key={preset.id}
                    onSelect={() => {
                      onProviderModelChange(
                        provider.providerID,
                        preset.id,
                      )
                      closeDropdown()
                    }}
                  >
                    <span className="rm-item-label">{preset.label}</span>
                    {provider.providerID === selectedProviderID &&
                    preset.id === selectedModelPreset ? (
                      <Check className="rm-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    ) : null}
                  </RTDropdownMenu.Item>
                ))}
                <RTDropdownMenu.Item
                  onSelect={() => {
                    onProviderModelChange(
                      provider.providerID,
                      CUSTOM_MODEL_PRESET_ID,
                    )
                    closeDropdown()
                  }}
                >
                  <span className="rm-item-label">自定义模型</span>
                  {provider.providerID === selectedProviderID &&
                  selectedModelPreset === CUSTOM_MODEL_PRESET_ID ? (
                    <Check className="rm-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  ) : null}
                </RTDropdownMenu.Item>
              </RTDropdownMenu.SubContent>
            </RTDropdownMenu.Portal>
          </RTDropdownMenu.Sub>
        ))}
      </RTDropdownMenu.Content>
    </RTDropdownMenu.Portal>
  </RTDropdownMenu.Root>
</Theme>
```

- [ ] **Step 4: Run typecheck to verify no type errors**

Run: `bun run desktop:typecheck`

Expected: PASS.

- [ ] **Step 5: Manual smoke test**

Run the desktop app (`bun run desktop:dev`) and verify:
- Model menu opens when clicking the model chip button.
- Thinking mode options (if applicable) toggle correctly.
- Provider sub-menus expand on hover/click.
- Selecting a model closes the menu and updates the displayed model.
- Empty state ("未配置模型") renders without errors when no providers are configured.
- Theme switching (light/dark/system) correctly affects the menu appearance.

---

### Task 5: Final validation and cleanup

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: all tasks above
- Produces: confirmed working pilot

- [ ] **Step 1: Run full typecheck**

Run: `bun run desktop:typecheck`

Expected: PASS.

- [ ] **Step 2: Verify no regressions in other menus**

Manually confirm that the context menu (Plus button), permission selector, mode menu, and branch menu still work exactly as before — they were not modified.

- [ ] **Step 3: Verify CSS cascade is not broken**

Confirm that:
- Local `.popover-*` styles still apply to non-model menus.
- Radix Themes base styles do not override local styles for other components.
- The model menu respects the current theme (light/dark).

---

## Design Decisions

1. **Aliased import (`RTDropdownMenu`)**: The file already imports `@radix-ui/react-dropdown-menu` as `DropdownMenu` for the context menu's `renderContextSwitchItem`. Radix Themes re-exports its own `DropdownMenu` which has different component APIs (e.g., `Theme` integration). Aliasing avoids naming collisions and keeps both systems working during the pilot.

2. **Scoped CSS classes (`rm-*` prefix)**: Rather than reusing `.popover-item` (which has specificity relationships with the existing popover system), the pilot uses new `rm-*` prefixed classes. This prevents CSS weight conflicts and makes cleanup trivial when the pilot is evaluated.

3. **Local `<Theme>` wrapper**: Wrapping only the model menu in `<Theme appearance={resolvedVariant}>` ensures Radix Themes applies its light/dark tokens locally without affecting the rest of the app. This is the recommended Radix Themes pattern for incremental adoption.

4. **Preserved state management**: The `openDropdown === 'model'` state, `closeDropdown()`, `onThinkingChange`, and `onProviderModelChange` callbacks are used identically. The Radix Themes `DropdownMenu.Root` accepts `open` and `onOpenChange` props just like the previous `PopoverMenu` did.

5. **No `PopoverItem` reuse**: Radix Themes `DropdownMenu.Item` has its own internal styling. Applying `.popover-item` classes on top would create specificity battles. The pilot's `rm-*` classes provide the necessary bridge styles independently.
