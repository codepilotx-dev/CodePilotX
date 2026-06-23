import { expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
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

test('default workspace-write policy allows ordinary workspace edits', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-edit',
    toolName: 'Edit',
    input: {
      file_path: join(workspacePath, 'src', 'index.ts'),
    },
    description: 'Edit file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'workspace-write',
        approvalMode: 'prompt',
      },
      request,
      workspacePath,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })
})

test('auto workspace-write policy allows ordinary workspace writes', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-write',
    toolName: 'Write',
    input: {
      file_path: join(workspacePath, 'src', 'created.ts'),
    },
    description: 'Write file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'workspace-write',
        approvalMode: 'auto-review',
      },
      request,
      workspacePath,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })
})

test('workspace-write policy still prompts for edits outside the workspace', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-outside',
    toolName: 'Edit',
    input: {
      file_path: resolve('tmp', 'other-workspace', 'index.ts'),
    },
    description: 'Edit file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'workspace-write',
        approvalMode: 'prompt',
      },
      request,
      workspacePath,
    ),
  ).toBe(null)
})

test('workspace-write policy still prompts for sensitive workspace paths', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const sensitivePaths = [
    join(workspacePath, '.git', 'config'),
    join(workspacePath, '.claude', 'settings.json'),
    join(workspacePath, '.vscode', 'settings.json'),
    join(workspacePath, 'src', '.gitconfig'),
    join(workspacePath, 'src', '.bashrc'),
  ]

  for (const filePath of sensitivePaths) {
    expect(
      resolveDesktopPermissionPolicyDecision(
        {
          profile: 'workspace-write',
          approvalMode: 'prompt',
        },
        {
          requestId: `permission-sensitive-${filePath}`,
          toolName: 'Edit',
          input: {
            file_path: filePath,
          },
          description: 'Edit file',
        },
        workspacePath,
      ),
    ).toBe(null)
  }
})

test('workspace-write policy still prompts for network paths', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-network',
    toolName: 'Edit',
    input: {
      file_path: '\\\\server\\share\\index.ts',
    },
    description: 'Edit file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'workspace-write',
        approvalMode: 'prompt',
      },
      request,
      workspacePath,
    ),
  ).toBe(null)
})

test('custom config policy still prompts for workspace writes', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-custom',
    toolName: 'Edit',
    input: {
      file_path: join(workspacePath, 'src', 'index.ts'),
    },
    description: 'Edit file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'workspace-write',
        approvalMode: 'config',
      },
      request,
      workspacePath,
    ),
  ).toBe(null)
})

test('bypass policy still allows every desktop tool action', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-bypass',
    toolName: 'Bash',
    input: {
      command: 'git status',
    },
    description: 'Run command',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: 'danger-full-access',
        approvalMode: 'bypass',
      },
      request,
      workspacePath,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })
})
