import { expect, test } from 'bun:test'
import {
  defaultDesktopStoredSettings,
  isLocalRouterMode,
  normalizeDesktopStoredSettings,
  normalizeLocalRouterMode,
} from './settingsSchema.js'

test('desktop settings no longer store AskUserQuestion max questions', () => {
  expect('askUserQuestionMaxQuestions' in defaultDesktopStoredSettings()).toBe(
    false,
  )
})

test('desktop settings default Rust search and diff kernels to disabled', () => {
  expect(defaultDesktopStoredSettings().rustSearchAndDiffKernels).toBe(false)
})

test('desktop settings default diff marker style to color', () => {
  expect(defaultDesktopStoredSettings().diffMarkerStyle).toBe('color')
})

test('desktop settings normalize diff marker style values', () => {
  expect(
    normalizeDesktopStoredSettings({ diffMarkerStyle: 'symbol' })
      .diffMarkerStyle,
  ).toBe('symbol')
  expect(
    normalizeDesktopStoredSettings({ diffMarkerStyle: 'invalid' })
      .diffMarkerStyle,
  ).toBe('color')
})

test('desktop settings default bundled dependencies to enabled', () => {
  expect(defaultDesktopStoredSettings().installCodexDependencies).toBe(true)
})

test('desktop settings normalize bundled dependencies as a boolean', () => {
  expect(
    normalizeDesktopStoredSettings({ installCodexDependencies: false })
      .installCodexDependencies,
  ).toBe(false)
  expect(
    normalizeDesktopStoredSettings({ installCodexDependencies: 'false' })
      .installCodexDependencies,
  ).toBe(true)
})

test('desktop settings default plan execution model to unset', () => {
  expect(defaultDesktopStoredSettings().planExecutionModel).toBe('')
})

test('desktop settings default new git branches to CodePilotX prefix', () => {
  expect(defaultDesktopStoredSettings().gitBranchPrefix).toBe('codepilotx/')
})

test('desktop settings normalize Rust search and diff kernels as a boolean', () => {
  expect(
    normalizeDesktopStoredSettings({ rustSearchAndDiffKernels: true })
      .rustSearchAndDiffKernels,
  ).toBe(true)
  expect(
    normalizeDesktopStoredSettings({ rustSearchAndDiffKernels: 'true' })
      .rustSearchAndDiffKernels,
  ).toBe(false)
})

test('desktop settings normalize plan execution model as a string', () => {
  expect(
    normalizeDesktopStoredSettings({ planExecutionModel: 'default' })
      .planExecutionModel,
  ).toBe('default')
  expect(
    normalizeDesktopStoredSettings({ planExecutionModel: 123 })
      .planExecutionModel,
  ).toBe('')
})

test('desktop settings drop legacy AskUserQuestion max questions values', () => {
  expect(
    'askUserQuestionMaxQuestions' in
      normalizeDesktopStoredSettings({ askUserQuestionMaxQuestions: 4 }),
  ).toBe(false)
})

test('desktop settings normalize plan permission mode to default', () => {
  expect(
    normalizeDesktopStoredSettings({ permissionMode: 'plan' }).permissionMode,
  ).toBe('default')
})

test('desktop settings default router toggles to disabled', () => {
  const defaults = defaultDesktopStoredSettings()
  expect(defaults.enableParetoCodeRouter).toBe(false)
  expect(defaults.enableFusionRouter).toBe(false)
})

test('desktop settings normalize router toggles as booleans', () => {
  expect(
    normalizeDesktopStoredSettings({ enableParetoCodeRouter: true })
      .enableParetoCodeRouter,
  ).toBe(true)
  expect(
    normalizeDesktopStoredSettings({ enableParetoCodeRouter: 'true' })
      .enableParetoCodeRouter,
  ).toBe(false)
  expect(
    normalizeDesktopStoredSettings({ enableFusionRouter: true })
      .enableFusionRouter,
  ).toBe(true)
  expect(
    normalizeDesktopStoredSettings({ enableFusionRouter: 'true' })
      .enableFusionRouter,
  ).toBe(false)
})

test('desktop settings fallback router toggles to false when missing', () => {
  expect(
    normalizeDesktopStoredSettings({}).enableParetoCodeRouter,
  ).toBe(false)
  expect(
    normalizeDesktopStoredSettings({}).enableFusionRouter,
  ).toBe(false)
})

test('isLocalRouterMode validates router mode values', () => {
  expect(isLocalRouterMode('off')).toBe(true)
  expect(isLocalRouterMode('pareto-code')).toBe(true)
  expect(isLocalRouterMode('fusion')).toBe(true)
  expect(isLocalRouterMode('invalid')).toBe(false)
  expect(isLocalRouterMode(undefined)).toBe(false)
  expect(normalizeLocalRouterMode('off')).toBe('off')
  expect(normalizeLocalRouterMode('pareto-code')).toBe('pareto-code')
  expect(normalizeLocalRouterMode('fusion')).toBe('fusion')
  expect(normalizeLocalRouterMode('invalid')).toBe('off')
  expect(normalizeLocalRouterMode(undefined)).toBe('off')
})
