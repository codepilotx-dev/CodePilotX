import { expect, test } from 'bun:test'
import {
  BUILTIN_CODEX_PERMISSION_PROFILES,
  createCodexRuntimePermissionState,
  evaluateFilesystemAccess,
  evaluateNetworkDomainAccess,
  resolveCodexPermissions,
  permissionPolicyForDesktopMode,
  type CodexRuntimePermissionState,
} from './permissions.js'
import type {
  CodexPermissionsConfig,
  CodexRequirementsPolicy,
} from './permissions.js'
import { parseCodexRequirements } from './codexRequirements.js'

test('official built-in permission profiles are available', () => {
  expect(BUILTIN_CODEX_PERMISSION_PROFILES).toEqual([
    ':read-only',
    ':workspace',
    ':danger-full-access',
  ])

  const resolved = resolveCodexPermissions({
    config: { defaultPermissions: ':workspace' },
    workspaceRoots: ['/repo'],
  })

  expect(resolved.activeProfile.name).toBe(':workspace')
  expect(resolved.activeProfile.filesystem).toEqual([
    { path: ':workspace_roots', access: 'write', source: 'config' },
  ])
})

test('custom profile extends workspace and can deny narrower filesystem paths', () => {
  const resolved = resolveCodexPermissions({
    config: {
      defaultPermissions: 'project-edit',
      permissions: {
        'project-edit': {
          extends: ':workspace',
          filesystem: {
            '**/*.env': 'deny',
          },
        },
      },
    },
    workspaceRoots: ['/repo'],
  })

  expect(evaluateFilesystemAccess(resolved.activeProfile, '/repo/src/index.ts')).toBe(
    'write',
  )
  expect(evaluateFilesystemAccess(resolved.activeProfile, '/repo/.env')).toBe(
    'deny',
  )
})

test('custom profile cannot extend danger-full-access', () => {
  expect(() =>
    resolveCodexPermissions({
      config: {
        defaultPermissions: 'unsafe',
        permissions: {
          unsafe: { extends: ':danger-full-access' },
        },
      },
      workspaceRoots: ['/repo'],
    }),
  ).toThrow('Custom permission profile cannot extend :danger-full-access')
})

test('permission resolver rejects unknown parents and inheritance cycles', () => {
  expect(() =>
    resolveCodexPermissions({
      config: {
        defaultPermissions: 'child',
        permissions: {
          child: { extends: 'missing' },
        },
      },
      workspaceRoots: ['/repo'],
    }),
  ).toThrow('Unknown permission profile: missing')

  expect(() =>
    resolveCodexPermissions({
      config: {
        defaultPermissions: 'a',
        permissions: {
          a: { extends: 'b' },
          b: { extends: 'a' },
        },
      },
      workspaceRoots: ['/repo'],
    }),
  ).toThrow('Permission profile inheritance cycle')
})

test('filesystem precedence uses narrower matches and deny wins ties', () => {
  const resolved = resolveCodexPermissions({
    config: {
      defaultPermissions: 'files',
      permissions: {
        files: {
          filesystem: {
            '/repo': 'read',
            '/repo/src': 'write',
            '/repo/src/secrets': 'deny',
            '/repo/src/secrets/public.txt': 'read',
            '/repo/tie.txt': ['read', 'deny'],
          },
        },
      },
    },
    workspaceRoots: ['/repo'],
  })

  expect(evaluateFilesystemAccess(resolved.activeProfile, '/repo/README.md')).toBe(
    'read',
  )
  expect(evaluateFilesystemAccess(resolved.activeProfile, '/repo/src/app.ts')).toBe(
    'write',
  )
  expect(
    evaluateFilesystemAccess(resolved.activeProfile, '/repo/src/secrets/key.txt'),
  ).toBe('deny')
  expect(
    evaluateFilesystemAccess(
      resolved.activeProfile,
      '/repo/src/secrets/public.txt',
    ),
  ).toBe('read')
  expect(evaluateFilesystemAccess(resolved.activeProfile, '/repo/tie.txt')).toBe(
    'deny',
  )
})

test('network domain rules support exact, wildcard, global, and deny priority', () => {
  const resolved = resolveCodexPermissions({
    config: {
      defaultPermissions: 'net',
      permissions: {
        net: {
          network: {
            enabled: true,
            domains: {
              '*': 'deny',
              '*.example.com': 'allow',
              '**.deep.example.com': 'allow',
              'blocked.example.com': 'deny',
            },
          },
        },
      },
    },
    workspaceRoots: ['/repo'],
  })

  expect(evaluateNetworkDomainAccess(resolved.activeProfile, 'api.example.com')).toBe(
    'allow',
  )
  expect(evaluateNetworkDomainAccess(resolved.activeProfile, 'blocked.example.com')).toBe(
    'deny',
  )
  expect(
    evaluateNetworkDomainAccess(resolved.activeProfile, 'a.b.deep.example.com'),
  ).toBe('allow')
  expect(evaluateNetworkDomainAccess(resolved.activeProfile, 'other.test')).toBe(
    'deny',
  )
})

test('requirements can provide managed defaults and restrict selectable profiles', () => {
  const resolved = resolveCodexPermissions({
    config: {
      defaultPermissions: 'local-profile',
      permissions: {
        'local-profile': { extends: ':workspace' },
      },
    },
    requirements: {
      defaultPermissions: 'managed-profile',
      allowedPermissionProfiles: ['managed-profile'],
      permissions: {
        'managed-profile': { extends: ':read-only' },
      },
    },
    workspaceRoots: ['/repo'],
  })

  expect(resolved.activeProfile.name).toBe('managed-profile')
  expect(evaluateFilesystemAccess(resolved.activeProfile, '/repo/src/index.ts')).toBe(
    'read',
  )

  expect(() =>
    resolveCodexPermissions({
      config: {
        defaultPermissions: 'local-profile',
        permissions: {
          'local-profile': { extends: ':workspace' },
        },
      },
      requirements: {
        allowedPermissionProfiles: [':read-only'],
      },
      workspaceRoots: ['/repo'],
    }),
  ).toThrow('Permission profile local-profile is not allowed by requirements')
})

test('requirements.toml parser supports official permission policy fields', () => {
  const requirements = parseCodexRequirements(`
allowed_permission_profiles = [":workspace", "managed-edit"]
default_permissions = "managed-edit"
allowed_approval_policies = ["on-request", "never"]
allowed_approvals_reviewers = ["user"]

[permissions.managed-edit]
extends = ":workspace"

[permissions.managed-edit.filesystem]
"**/*.env" = "deny"

[permissions.filesystem]
deny_read = ["**/secrets/**"]

[experimental_network]
enabled = true
allowed_domains = ["api.openai.com"]
denied_domains = ["*.evil.test"]
managed_allowed_domains_only = true
http_proxy_port = 8080
allow_unix_sockets = ["/tmp/codex.sock"]
allow_local_network = false
`)

  const resolved = resolveCodexPermissions({
    workspaceRoots: ['/repo'],
    requirements,
  })

  expect(resolved.activeProfile.name).toBe('managed-edit')
  expect(evaluateFilesystemAccess(resolved.activeProfile, '/repo/.env')).toBe(
    'deny',
  )
  expect(evaluateFilesystemAccess(resolved.activeProfile, '/repo/secrets/key')).toBe(
    'deny',
  )
  expect(
    evaluateNetworkDomainAccess(resolved.activeProfile, 'api.openai.com'),
  ).toBe('allow')
  expect(evaluateNetworkDomainAccess(resolved.activeProfile, 'x.evil.test')).toBe(
    'deny',
  )
  expect(resolved.activeProfile.network.httpProxyPort).toBe(8080)
})

// CodexRuntimePermissionState tests
test('createCodexRuntimePermissionState: CLI overrides take precedence over .codex/config.toml', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: ':workspace',
    approvalPolicy: 'on-request',
  }
  const overrides = {
    defaultPermissions: ':danger-full-access',
    approvalPolicy: 'never' as const,
  }
  const state = createCodexRuntimePermissionState({
    projectConfig,
    overrides,
    workspaceRoots: ['/repo'],
  })

  expect(state.resolved.defaultPermissions).toBe(':danger-full-access')
  expect(state.resolved.approvalPolicy).toBe('never')
  expect(state.derivedPolicy.profile).toBe(':danger-full-access')
  expect(state.derivedPolicy.approvalMode).toBe('never')
  expect(state.derivedPolicy.actionScopes?.read).toBe('allow')
  expect(state.derivedPolicy.actionScopes?.write).toBe('allow')
})

test('createCodexRuntimePermissionState: project config overrides built-in defaults', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: ':read-only',
    approvalPolicy: 'on-failure',
    approvalsReviewer: 'auto_review',
  }
  const state = createCodexRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  expect(state.resolved.defaultPermissions).toBe(':read-only')
  expect(state.resolved.approvalPolicy).toBe('on-failure')
  expect(state.resolved.approvalsReviewer).toBe('auto_review')
  expect(state.derivedPolicy.actionScopes?.read).toBe('allow')
  expect(state.derivedPolicy.actionScopes?.write).toBe('ask')
})

test('createCodexRuntimePermissionState: official sandbox_mode maps to builtin profiles', () => {
  const workspace = createCodexRuntimePermissionState({
    projectConfig: { sandboxMode: 'workspace-write' },
    workspaceRoots: ['/repo'],
  })
  expect(workspace.resolved.defaultPermissions).toBe(':workspace')
  expect(workspace.derivedPolicy.sandboxMode).toBe('workspace-write')
  expect(workspace.sandboxOverlay.filesystem.allowWrite).toContain('/repo')

  const readOnly = createCodexRuntimePermissionState({
    projectConfig: { sandboxMode: 'read-only' },
    workspaceRoots: ['/repo'],
  })
  expect(readOnly.resolved.defaultPermissions).toBe(':read-only')
  expect(readOnly.derivedPolicy.sandboxMode).toBe('read-only')

  const fullAccess = createCodexRuntimePermissionState({
    projectConfig: { sandboxMode: 'danger-full-access' },
    workspaceRoots: ['/repo'],
  })
  expect(fullAccess.resolved.defaultPermissions).toBe(':danger-full-access')
  expect(fullAccess.derivedPolicy.sandboxMode).toBe('danger-full-access')
})

test('createCodexRuntimePermissionState: workspace-write writable roots and reviewer aliases', () => {
  const state = createCodexRuntimePermissionState({
    projectConfig: {
      sandboxMode: 'workspace-write',
      approvalsReviewer: 'guardian_subagent',
      sandboxWorkspaceWrite: {
        writableRoots: ['/tmp/build-cache'],
        networkAccess: true,
      },
    },
    workspaceRoots: ['/repo'],
  })

  expect(state.resolved.approvalsReviewer).toBe('auto_review')
  expect(state.sandboxOverlay.filesystem.allowWrite).toContain(
    '/tmp/build-cache',
  )
  expect(state.resolved.activeProfile.network.enabled).toBe(true)
})

test('createCodexRuntimePermissionState: requirements have highest constraint', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: ':danger-full-access',
    approvalPolicy: 'never',
  }
  const requirements: CodexRequirementsPolicy = {
    defaultPermissions: ':workspace',
    allowedPermissionProfiles: [':workspace'],
    allowedApprovalPolicies: ['on-request', 'never'],
  }
  const state = createCodexRuntimePermissionState({
    projectConfig,
    requirements,
    workspaceRoots: ['/repo'],
  })

  // requirements.defaultPermissions overrides projectConfig.defaultPermissions
  expect(state.resolved.defaultPermissions).toBe(':workspace')
  // projectConfig.approvalPolicy is used (not overridden by requirements)
  // but validated against requirements.allowedApprovalPolicies
  expect(state.resolved.approvalPolicy).toBe('never')
})

test('createCodexRuntimePermissionState: requirements reject invalid profiles', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: ':danger-full-access',
  }
  const requirements: CodexRequirementsPolicy = {
    allowedPermissionProfiles: [':read-only'],
  }
  expect(() =>
    createCodexRuntimePermissionState({
      projectConfig,
      requirements,
      workspaceRoots: ['/repo'],
    }),
  ).toThrow('not allowed by requirements')
})

test('createCodexRuntimePermissionState: sandbox overlay for :workspace profile', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: ':workspace',
  }
  const state = createCodexRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  expect(state.sandboxOverlay.filesystem.allowWrite).toContain('/repo')
  expect(state.sandboxOverlay.filesystem.denyRead).toEqual([])
  expect(state.sandboxOverlay.network.allowedDomains).toEqual([])
})

test('createCodexRuntimePermissionState: sandbox overlay for :danger-full-access profile', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: ':danger-full-access',
  }
  const state = createCodexRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  // danger-full-access has no filesystem overlay restrictions
  expect(state.sandboxOverlay.filesystem.allowWrite).toEqual([])
  expect(state.sandboxOverlay.filesystem.denyWrite).toEqual([])
  // network domains still come through from the builtin profile config
  expect(state.sandboxOverlay.network.allowedDomains).toContain('*')
})

test('createCodexRuntimePermissionState: sandbox overlay for :read-only profile', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: ':read-only',
  }
  const state = createCodexRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  expect(state.sandboxOverlay.filesystem.allowRead).toContain('/repo')
  expect(state.sandboxOverlay.filesystem.allowWrite).toEqual([])
})

test('createCodexRuntimePermissionState: custom profile with filesystem deny rules', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: 'restricted',
    permissions: {
      restricted: {
        extends: ':workspace',
        filesystem: {
          '**/*.secret': 'deny',
          '/tmp/custom-log': 'write',
        },
      },
    },
  }
  const state = createCodexRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  // extends :workspace so workspace roots are writable
  expect(state.sandboxOverlay.filesystem.allowWrite).toContain('/repo')
  expect(state.sandboxOverlay.filesystem.allowWrite).toContain('/tmp/custom-log')
  expect(state.sandboxOverlay.filesystem.denyWrite).toContain('**/*.secret')
  expect(state.sandboxOverlay.filesystem.denyRead).toContain('**/*.secret')
})

test('createCodexRuntimePermissionState: custom profile with network domain rules', () => {
  const projectConfig: CodexPermissionsConfig = {
    defaultPermissions: 'netted',
    permissions: {
      netted: {
        network: {
          enabled: true,
          domains: {
            'api.example.com': 'allow',
            'evil.test': 'deny',
          },
        },
      },
    },
  }
  const state = createCodexRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  expect(state.sandboxOverlay.network.allowedDomains).toContain('api.example.com')
  expect(state.sandboxOverlay.network.deniedDomains).toContain('evil.test')
})

test('permissionPolicyForDesktopMode exposes official Codex sandbox modes', () => {
  expect(permissionPolicyForDesktopMode('default')).toMatchObject({
    profile: ':workspace',
    approvalMode: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write',
  })
  expect(permissionPolicyForDesktopMode('auto-review')).toMatchObject({
    profile: ':workspace',
    approvalMode: 'on-request',
    approvalsReviewer: 'auto_review',
    sandboxMode: 'workspace-write',
  })
  expect(permissionPolicyForDesktopMode('full-access')).toMatchObject({
    profile: ':danger-full-access',
    approvalMode: 'never',
    sandboxMode: 'danger-full-access',
  })
  expect(permissionPolicyForDesktopMode('custom')).toMatchObject({
    profile: ':workspace',
    approvalMode: 'on-request',
    sandboxMode: 'workspace-write',
  })
  expect(permissionPolicyForDesktopMode('auto')).toMatchObject({
    approvalsReviewer: 'auto_review',
  })
})
