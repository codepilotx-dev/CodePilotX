export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

import { requireOptionalPackage } from './optionalPackage.js'

type ModifiersNapi = {
  prewarm: () => void
  isModifierPressed: (m: string) => boolean
}

let prewarmed = false

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early to avoid delay on first use.
 */
export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== 'darwin') {
    return
  }
  prewarmed = true
  // Load module in background
  try {
    requireOptionalPackage<ModifiersNapi>('modifiers-napi')?.prewarm()
  } catch {
    // Ignore errors during prewarm
  }
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 */
export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== 'darwin') {
    return false
  }
  return (
    requireOptionalPackage<ModifiersNapi>('modifiers-napi')?.isModifierPressed(
      modifier,
    ) ?? false
  )
}
