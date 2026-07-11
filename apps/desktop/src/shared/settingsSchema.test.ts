import { expect, test } from 'bun:test'
import {
  defaultDesktopStoredSettings,
  isLocalRouterMode,
  normalizeDesktopStoredSettings,
  normalizeDesktopWorkspaces,
  normalizeLocalRouterMode,
  upsertRecentWorkspace,
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
  expect(defaultDesktopStoredSettings().installCodePilotXDependencies).toBe(true)
})

test('desktop settings normalize bundled dependencies as a boolean', () => {
  expect(
    normalizeDesktopStoredSettings({ installCodePilotXDependencies: false })
      .installCodePilotXDependencies,
  ).toBe(false)
  expect(
    normalizeDesktopStoredSettings({ installCodePilotXDependencies: 'false' })
      .installCodePilotXDependencies,
  ).toBe(true)
})

test('desktop settings default plan execution model to unset', () => {
  expect(defaultDesktopStoredSettings().planExecutionModel).toBe('')
})

test('desktop settings default provider to unconfigured', () => {
  expect(defaultDesktopStoredSettings().providerID).toBe('')
})

test('desktop settings preserve empty provider as unconfigured', () => {
  expect(normalizeDesktopStoredSettings({ providerID: '' }).providerID).toBe('')
  expect(normalizeDesktopStoredSettings({ providerID: 123 }).providerID).toBe('')
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

test('desktop settings normalize permission option toggles as booleans', () => {
  const defaults = defaultDesktopStoredSettings()
  expect(defaults.enableAutoReviewPermissionMode).toBe(false)
  expect(defaults.enableFullAccessPermissionMode).toBe(false)
  expect(
    normalizeDesktopStoredSettings({
      enableAutoReviewPermissionMode: true,
      enableFullAccessPermissionMode: true,
    }).enableAutoReviewPermissionMode,
  ).toBe(true)
  expect(
    normalizeDesktopStoredSettings({
      enableAutoReviewPermissionMode: 'true',
      enableFullAccessPermissionMode: 'true',
    }).enableFullAccessPermissionMode,
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

	test('normalizeDesktopWorkspaces preserves valid pinnedAt string', () => {
	  const result = normalizeDesktopWorkspaces([
	    { name: 'test', path: '/test', pinnedAt: '2026-07-07T10:00:00.000Z' },
	  ])
	  expect(result).toHaveLength(1)
	  expect(result[0].pinnedAt).toBe('2026-07-07T10:00:00.000Z')
	})

	test('normalizeDesktopWorkspaces normalizes non-string pinnedAt to null', () => {
	  const result = normalizeDesktopWorkspaces([
	    { name: 'test', path: '/test', pinnedAt: 123 },
	  ])
	  expect(result).toHaveLength(1)
	  expect(result[0].pinnedAt).toBeNull()
	})

	test('normalizeDesktopWorkspaces normalizes missing pinnedAt to null', () => {
	  const result = normalizeDesktopWorkspaces([
	    { name: 'test', path: '/test' },
	  ])
	  expect(result).toHaveLength(1)
	  expect(result[0].pinnedAt).toBeNull()
	})

	test('upsertRecentWorkspace preserves existing pinnedAt when incoming lacks it', () => {
	  const workspaces = [
	    { name: 'existing', path: '/existing', pinnedAt: '2026-07-07T10:00:00.000Z' },
	  ]
	  const result = upsertRecentWorkspace(workspaces, {
	    name: 'existing',
	    path: '/existing',
	  })
	  expect(result).toHaveLength(1)
	  expect(result[0].pinnedAt).toBe('2026-07-07T10:00:00.000Z')
	})

	test('upsertRecentWorkspace updates pinnedAt when incoming has explicit value', () => {
	  const workspaces = [
	    { name: 'existing', path: '/existing', pinnedAt: '2026-07-07T10:00:00.000Z' },
	  ]
	  const result = upsertRecentWorkspace(workspaces, {
	    name: 'existing',
	    path: '/existing',
	    pinnedAt: '2026-07-08T10:00:00.000Z',
	  })
	  expect(result).toHaveLength(1)
	  expect(result[0].pinnedAt).toBe('2026-07-08T10:00:00.000Z')
	})

	test('upsertRecentWorkspace clears pinnedAt when incoming has explicit null', () => {
	  const workspaces = [
	    { name: 'existing', path: '/existing', pinnedAt: '2026-07-07T10:00:00.000Z' },
	  ]
	  const result = upsertRecentWorkspace(workspaces, {
	    name: 'existing',
	    path: '/existing',
	    pinnedAt: null,
	  })
	  expect(result).toHaveLength(1)
	  expect(result[0].pinnedAt).toBeNull()
	})

test('desktop settings default collapsed sidebar sections to empty', () => {
  expect(defaultDesktopStoredSettings().collapsedSidebarSections).toEqual([])
})

test('desktop settings default sidebar organization, sort, and manual order', () => {
  const defaults = defaultDesktopStoredSettings()
  expect(defaults.sidebarOrganization).toBe('projects')
  expect(defaults.sidebarSort).toBe('priority')
  expect(defaults.sidebarManualOrder).toEqual({})
})

test('desktop settings normalize sidebar organization and sort values', () => {
  expect(
    normalizeDesktopStoredSettings({
      sidebarOrganization: 'flat',
      sidebarSort: 'manual',
    }),
  ).toMatchObject({
    sidebarOrganization: 'flat',
    sidebarSort: 'manual',
  })
  expect(
    normalizeDesktopStoredSettings({
      sidebarOrganization: 'invalid',
      sidebarSort: 'invalid',
    }),
  ).toMatchObject({
    sidebarOrganization: 'projects',
    sidebarSort: 'priority',
  })
})

test('desktop settings normalize sidebar manual order as string arrays by scope', () => {
  expect(
    normalizeDesktopStoredSettings({
      sidebarManualOrder: {
        root: ['session-2', 'session-1', 'session-2', 3],
        invalid: 'session-3',
      },
    }).sidebarManualOrder,
  ).toEqual({
    root: ['session-2', 'session-1'],
  })
  expect(
    normalizeDesktopStoredSettings({
      sidebarManualOrder: 'invalid',
    }).sidebarManualOrder,
  ).toEqual({})
})

	test('desktop settings normalize collapsed sidebar sections preserves valid values', () => {
	  expect(
	    normalizeDesktopStoredSettings({ collapsedSidebarSections: ['pinned'] })
	      .collapsedSidebarSections,
	  ).toEqual(['pinned'])
	})

	test('desktop settings normalize collapsed sidebar sections filters invalid values', () => {
	  expect(
	    normalizeDesktopStoredSettings({ collapsedSidebarSections: ['invalid'] })
	      .collapsedSidebarSections,
	  ).toEqual([])
	})

	test('desktop settings normalize collapsed sidebar sections deduplicates', () => {
	  expect(
	    normalizeDesktopStoredSettings({
	      collapsedSidebarSections: ['pinned', 'pinned'],
	    }).collapsedSidebarSections,
	  ).toEqual(['pinned'])
	})

	test('desktop settings normalize collapsed sidebar sections handles partial validity', () => {
	  expect(
	    normalizeDesktopStoredSettings({
	      collapsedSidebarSections: ['pinned', 'invalid', 'projects'],
	    }).collapsedSidebarSections,
	  ).toEqual(['pinned', 'projects'])
	})

	test('desktop settings normalize collapsed sidebar sections rejects non-array', () => {
	  expect(
	    normalizeDesktopStoredSettings({
	      collapsedSidebarSections: 'pinned',
	    }).collapsedSidebarSections,
	  ).toEqual([])
	})
