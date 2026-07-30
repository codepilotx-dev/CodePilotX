import type { PerformanceBudget } from './metrics.js'

export const rendererBudgets: readonly PerformanceBudget[] = [
  { scenario: 'sidebar-resize', metric: 'frameP95Ms', max: 20 },
  { scenario: 'sidebar-resize', metric: 'writesDuringDrag', max: 0 },
  { scenario: 'sidebar-resize', metric: 'writesAfterDrop', min: 1, max: 1 },
  { scenario: 'selector', metric: 'selectorP95Ms', max: 12 },
  { scenario: 'selector', metric: 'growthFactor', max: 6 },
  { scenario: 'timeline-scroll', metric: 'frameP95Ms', max: 34 },
  { scenario: 'timeline-scroll', metric: 'maxLongTaskMs', max: 200 },
  { scenario: 'timeline-scroll', metric: 'mountedTurns', max: 80 },
  { scenario: 'cold-switch', metric: 'readyMs', max: 400 },
  { scenario: 'cold-switch', metric: 'staleVisibleMs', max: 100 },
  { scenario: 'cached-switch', metric: 'cachedContentMs', max: 100 },
  { scenario: 'cached-switch', metric: 'readyMs', max: 300 },
  { scenario: 'composer-input', metric: 'inputToPaintP95Ms', max: 50 },
  { scenario: 'composer-input', metric: 'relativeDegradationPercent', max: 10 },
  { scenario: 'sidebar-dnd', metric: 'moveMs', max: 80 },
  { scenario: 'sidebar-dnd', metric: 'dropReadyMs', max: 250 },
  { scenario: 'memory-stability', metric: 'heapRegressionScore', max: 0 },
] as const

export const electronBudgets: readonly PerformanceBudget[] = [
  { scenario: 'cold-start', metric: 'readyMs', max: 8_000 },
  { scenario: 'warm-start', metric: 'readyMs', max: 5_000 },
  { scenario: 'timeline-scroll', metric: 'frameP95Ms', max: 40 },
  { scenario: 'timeline-scroll', metric: 'maxLongTaskMs', max: 300 },
  { scenario: 'cold-switch', metric: 'readyMs', max: 800 },
  { scenario: 'sidebar-dnd', metric: 'dropReadyMs', max: 400 },
  { scenario: 'composer-input', metric: 'inputToPaintP95Ms', max: 75 },
  { scenario: 'memory-stability', metric: 'memoryRegressionScore', max: 0 },
] as const
