import { expect, test } from 'bun:test'
import {
  permissionActionForDesktopTool,
  resolveDesktopPermissionPolicyDecision,
} from './agentSession.js'

test('permissionActionForDesktopTool maps common desktop tools to policy actions', () => {
  expect(permissionActionForDesktopTool('Read')).toBe('read')
  expect(permissionActionForDesktopTool('Edit')).toBe('write')
  expect(permissionActionForDesktopTool('Bash')).toBe('shell')
  expect(permissionActionForDesktopTool('WebFetch')).toBe('network')
  expect(permissionActionForDesktopTool('mcp__docs__search')).toBe('mcp')
  expect(permissionActionForDesktopTool('UnknownTool')).toBe('shell')
})

test('resolveDesktopPermissionPolicyDecision short-circuits allow and deny effects only', () => {
  const request = {
    requestId: 'permission-1',
    toolName: 'Bash',
    input: {},
    description: 'Run command',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'danger-full-access',
        approvalMode: 'bypass',
      },
      request,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'workspace-write',
        approvalMode: 'config',
        toolOverrides: {
          Bash: {
            shell: 'deny',
          },
        },
      },
      request,
    ),
  ).toEqual({
    behavior: 'deny',
    message: 'Permission denied by workspace-write permission profile',
  })

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'workspace-write',
        approvalMode: 'prompt',
      },
      request,
    ),
  ).toBe(null)
})
