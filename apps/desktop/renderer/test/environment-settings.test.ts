import { describe, expect, test } from 'bun:test'
import type { DesktopWorkspace } from '../shared/types.js'
import {
  isProjectSettingsConflict,
  sortEnvironmentProjects,
} from '../src/features/settings/environmentSettingsModel.js'

describe('environment settings model', () => {
  test('sorts projects by recent activity and then by name', () => {
    const projects = [
      workspace('later-name', '2026-01-01T00:00:00.000Z'),
      workspace('recent', '2026-02-01T00:00:00.000Z'),
      workspace('earlier-name', '2026-01-01T00:00:00.000Z'),
    ]

    expect(sortEnvironmentProjects(projects).map(project => project.name)).toEqual([
      'recent',
      'earlier-name',
      'later-name',
    ])
    expect(projects.map(project => project.name)).toEqual([
      'later-name',
      'recent',
      'earlier-name',
    ])
  })

  test('recognizes safe RPC conflict envelopes', () => {
    expect(isProjectSettingsConflict({
      errorCode: 'PROJECT_SETTINGS_CONFLICT',
    })).toBe(true)
    expect(isProjectSettingsConflict({
      data: { code: 'PROJECT_SETTINGS_CONFLICT' },
    })).toBe(true)
    expect(isProjectSettingsConflict(new Error('conflict'))).toBe(false)
  })
})

function workspace(name: string, lastOpenedAt: string): DesktopWorkspace {
  return {
    name,
    path: `C:\\projects\\${name}`,
    lastOpenedAt,
  }
}
