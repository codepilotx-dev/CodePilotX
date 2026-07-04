/**
 * Cache clearing utilities.
 *
 * Core provides the orchestrator; TUI registers its specific cleanup
 * callbacks so core doesn't need to depend on TUI-internal modules
 * (commands, agents, plugins, etc.).
 */

/** A function that performs a cache-clearing operation. */
export type CacheCleanupFn = () => void

/** Registered TUI-specific cleanup callbacks. */
const tuiCleanupFns: CacheCleanupFn[] = []

/**
 * Register a TUI-side cache cleanup callback.
 * Called by TUI during initialization to register its cache-clearing
 * functions (commands, agents, plugins, output styles, etc.).
 */
export function registerCacheCleanup(fn: CacheCleanupFn): void {
  tuiCleanupFns.push(fn)
}

/**
 * Clear all registered caches.
 * This calls all TUI-registered cleanup callbacks, plus any additional
 * callbacks passed directly.
 */
export function clearAllCaches(...extraFns: CacheCleanupFn[]): void {
  for (const fn of tuiCleanupFns) {
    fn()
  }
  for (const fn of extraFns) {
    fn()
  }
}

/**
 * Clear only plugin-level caches (not commands or agents).
 */
export function clearAllPluginCaches(...extraFns: CacheCleanupFn[]): void {
  // Plugin-specific cleanup only; commands/agents stay.
  // Currently registered callbacks handle all caches; this function
  // exists for callers that want to scope to plugins only.
  for (const fn of extraFns) {
    fn()
  }
}
