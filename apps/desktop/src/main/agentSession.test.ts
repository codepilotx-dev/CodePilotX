import { expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import {
  createDesktopAgentSession,
  permissionActionForDesktopTool,
  resolveDesktopPermissionPolicyDecision,
} from './agentSession.js'
import type {
  DesktopAgentRuntime,
  DesktopAgentRuntimeContext,
} from './agentRuntime.js'
import type { DesktopAgentEvent } from '../shared/types.js'
import type { DesktopAutoReviewService } from './autoReviewService.js'

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
        profile: ':danger-full-access',
        approvalMode: 'never',
        sandboxMode: 'danger-full-access',
        actionScopes: {
          shell: 'allow',
        },
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
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
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
    message: 'Permission denied by :workspace permission profile',
  })

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
      },
      request,
    ),
  ).toBe(null)
})

test('workspace-write policy allows ordinary workspace edits', () => {
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
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
      },
      request,
      workspacePath,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })
})

test('auto-review workspace-write policy allows ordinary workspace writes', () => {
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
        profile: ':workspace',
        approvalMode: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxMode: 'workspace-write',
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
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
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
          profile: ':workspace',
          approvalMode: 'on-request',
          sandboxMode: 'workspace-write',
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
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
      },
      request,
      workspacePath,
    ),
  ).toBe(null)
})

test('custom read-only policy still prompts for workspace writes', () => {
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
        profile: ':read-only',
        approvalMode: 'on-request',
        sandboxMode: 'read-only',
      },
      request,
      workspacePath,
    ),
  ).toBe(null)
})

test('full access policy still allows every desktop tool action', () => {
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
        profile: ':danger-full-access',
        approvalMode: 'never',
        sandboxMode: 'danger-full-access',
        actionScopes: {
          shell: 'allow',
        },
      },
      request,
      workspacePath,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })
})

test('auto-review session routes shell approval through reviewer without emitting user permission request', async () => {
  const events: DesktopAgentEvent[] = []
  const decisions: unknown[] = []
  const autoReviewService: DesktopAutoReviewService = {
    review: async () => ({
      type: 'decision',
      decision: {
        behavior: 'allow',
        alwaysAllow: false,
      },
      reason: 'reviewed as low risk',
    }),
  }
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-auto-review',
      suppressStartupMessage: true,
      permissionMode: 'auto-review',
      approvalsReviewer: 'auto_review',
    },
    {
      autoReviewService,
      createRuntime: context => createPermissionRuntime(context, decisions),
    },
  )
  session.on('event', event => events.push(event))

  await session.sendUserMessage('run command', 'run command')

  expect(decisions).toEqual([
    {
      behavior: 'allow',
      alwaysAllow: false,
    },
  ])
  expect(events.some(event => event.type === 'permission_request')).toBe(false)
})

test('auto-review fallback emits user permission request with fallback reason', async () => {
  const permissionRequests: DesktopAgentEvent[] = []
  const autoReviewService: DesktopAutoReviewService = {
    review: async () => ({
      type: 'fallback',
      reason: 'Reviewer returned invalid JSON',
    }),
  }
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-auto-review-fallback',
      suppressStartupMessage: true,
      permissionMode: 'auto-review',
      approvalsReviewer: 'auto_review',
    },
    {
      autoReviewService,
      createRuntime: context => createPermissionRuntime(context, []),
    },
  )
  session.on('event', event => {
    if (event.type === 'permission_request') {
      permissionRequests.push(event)
      void session.respondToPermission(event.request.requestId, {
        behavior: 'deny',
        message: 'user denied',
      })
    }
  })

  await session.sendUserMessage('run command', 'run command')

  expect(permissionRequests).toHaveLength(1)
  const [event] = permissionRequests
  expect(event.type).toBe('permission_request')
  if (event.type === 'permission_request') {
    expect(event.request.autoReviewFallbackReason).toBe(
      'Reviewer returned invalid JSON',
    )
  }
})

function createPermissionRuntime(
  context: DesktopAgentRuntimeContext,
  decisions: unknown[],
): DesktopAgentRuntime {
  return {
    setModel: () => {},
    setModelProvider: () => {},
    setDebugConversationDump: () => {},
    setPermissionMode: () => {},
    async runUserTurn() {
      const decision = await context.requestPermission({
        requestId: 'permission-1',
        toolName: 'PowerShell',
        input: { command: 'echo ok' },
        description: 'Run shell',
      })
      decisions.push(decision)
    },
  }
}
