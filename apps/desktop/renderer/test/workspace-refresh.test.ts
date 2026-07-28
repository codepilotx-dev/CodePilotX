import { describe, expect, test } from 'bun:test'
import type { DesktopWorkspace } from '../shared/types.js'
import {
  createWorkspaceRefreshCoordinator,
  workspaceIdentity,
} from '../src/features/workspace/useWorkspaceState.js'

describe('workspace refresh coordination', () => {
  test('normalizes paths while preserving project and folder identity', () => {
    const first = workspace({
      path: 'C:\\Code\\Project\\',
      projectId: 'project-a',
      primaryFolderId: 'folder-a',
    })

    expect(
      workspaceIdentity(
        workspace({
          path: 'c:/code/project',
          projectId: 'project-a',
          primaryFolderId: 'folder-a',
        }),
      ),
    ).toBe(workspaceIdentity(first))
    expect(
      workspaceIdentity(
        workspace({
          path: 'c:/code/project',
          projectId: 'project-b',
          primaryFolderId: 'folder-a',
        }),
      ),
    ).not.toBe(workspaceIdentity(first))
    expect(
      workspaceIdentity(
        workspace({
          path: 'c:/code/project',
          projectId: 'project-a',
          primaryFolderId: 'folder-b',
        }),
      ),
    ).not.toBe(workspaceIdentity(first))
  })

  test('reuses in-flight work, skips an applied identity, and honors force', async () => {
    let loads = 0
    const coordinator = createWorkspaceRefreshCoordinator(async () => {
      loads += 1
      return loads
    })
    const firstWorkspace = workspace({ path: 'C:\\Code\\Project\\' })
    const equivalentWorkspace = workspace({ path: 'c:/code/project' })

    const first = coordinator.load(firstWorkspace)
    const duplicate = coordinator.load(equivalentWorkspace)
    const forcedDuplicate = coordinator.load(equivalentWorkspace, {
      force: true,
    })
    expect(first).not.toBeNull()
    expect(duplicate).toBe(first)
    expect(forcedDuplicate).toBe(first)
    expect(loads).toBe(1)

    await first
    coordinator.markApplied(firstWorkspace)
    expect(coordinator.load(equivalentWorkspace)).toBeNull()
    expect(loads).toBe(1)

    const different = coordinator.load(workspace({ path: 'C:\\Code\\Other' }))
    expect(different).not.toBeNull()
    await different
    expect(loads).toBe(2)

    const forced = coordinator.load(equivalentWorkspace, { force: true })
    expect(forced).not.toBeNull()
    await forced
    expect(loads).toBe(3)
  })
})

function workspace(
  overrides: Partial<DesktopWorkspace> = {},
): DesktopWorkspace {
  return {
    name: 'Workspace',
    path: 'C:\\Code\\Project',
    ...overrides,
  }
}
