import { describe, expect, test, beforeEach } from 'bun:test'
import { join, resolve } from 'node:path'
import {
  assertAllowedWorkspace,
  assertPathInsideAllowedWorkspace,
  clearAllowedWorkspacesForTest,
  isPathInsideAllowedWorkspace,
  registerAllowedWorkspace,
} from './workspacePathGuard.js'

describe('workspace path guard', () => {
  beforeEach(() => {
    clearAllowedWorkspacesForTest()
  })

  test('allows registered workspace roots and child paths', () => {
    const workspace = resolve('tmp', 'project-a')
    const child = join(workspace, 'src', 'index.ts')

    registerAllowedWorkspace(workspace)

    expect(assertAllowedWorkspace(workspace)).toBe(workspace)
    expect(isPathInsideAllowedWorkspace(workspace)).toBe(true)
    expect(assertPathInsideAllowedWorkspace(child)).toBe(child)
  })

  test('rejects paths outside registered workspaces', () => {
    const workspace = resolve('tmp', 'project-a')
    const sibling = resolve('tmp', 'project-b', 'index.ts')

    registerAllowedWorkspace(workspace)

    expect(() => assertAllowedWorkspace(sibling)).toThrow()
    expect(() => assertPathInsideAllowedWorkspace(sibling)).toThrow()
  })

  test('does not allow sibling paths with matching prefixes', () => {
    const workspace = resolve('tmp', 'project')
    const siblingWithPrefix = resolve('tmp', 'project-copy', 'file.ts')

    registerAllowedWorkspace(workspace)

    expect(isPathInsideAllowedWorkspace(siblingWithPrefix)).toBe(false)
  })
})
