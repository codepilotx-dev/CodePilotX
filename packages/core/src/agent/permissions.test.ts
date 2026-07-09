import { expect, test } from 'bun:test'
import {
  BUILTIN_CODEPILOTX_PERMISSION_PROFILES,
  createCodePilotXRuntimePermissionState,
  DESKTOP_AGENT_PERMISSION_MODES,
  evaluateFilesystemAccess,
  evaluateNetworkDomainAccess,
  isDesktopAgentPermissionMode,
  normalizeDesktopAgentPermissionMode,
  resolveCodePilotXPermissions,
  permissionPolicyForDesktopMode,
  type CodePilotXRuntimePermissionState,
} from './permissions.js'
import type {
  CodePilotXPermissionsConfig,
  CodePilotXRequirementsPolicy,
} from './permissions.js'
import { parseCodePilotXRequirements } from './codePilotXRequirements.js'

test('official built-in permission profiles are available', () => {
  expect(BUILTIN_CODEPILOTX_PERMISSION_PROFILES).toEqual([
    ':read-only',
    ':workspace',
    ':danger-full-access',
  ])

  const resolved = resolveCodePilotXPermissions({
    config: { defaultPermissions: ':workspace' },
    workspaceRoots: ['/repo'],
  })

  expect(resolved.activeProfile.name).toBe(':workspace')
  expect(resolved.activeProfile.filesystem).toEqual([
    { path: ':workspace_roots', access: 'write', source: 'config' },
  ])
})

test('custom profile extends workspace and can deny narrower filesystem paths', () => {
  const resolved = resolveCodePilotXPermissions({
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
    resolveCodePilotXPermissions({
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
    resolveCodePilotXPermissions({
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
    resolveCodePilotXPermissions({
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
  const resolved = resolveCodePilotXPermissions({
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
  const resolved = resolveCodePilotXPermissions({
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
  const resolved = resolveCodePilotXPermissions({
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
    resolveCodePilotXPermissions({
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
  const requirements = parseCodePilotXRequirements(`
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

  const resolved = resolveCodePilotXPermissions({
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

// CodePilotXRuntimePermissionState tests
test('createCodePilotXRuntimePermissionState: CLI overrides take precedence over .codepilotx/config.toml', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
    defaultPermissions: ':workspace',
    approvalPolicy: 'on-request',
  }
  const overrides = {
    defaultPermissions: ':danger-full-access',
    approvalPolicy: 'never' as const,
  }
  const state = createCodePilotXRuntimePermissionState({
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

test('createCodePilotXRuntimePermissionState: project config overrides built-in defaults', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
    defaultPermissions: ':read-only',
    approvalPolicy: 'on-failure',
    approvalsReviewer: 'auto_review',
  }
  const state = createCodePilotXRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  expect(state.resolved.defaultPermissions).toBe(':read-only')
  expect(state.resolved.approvalPolicy).toBe('on-failure')
  expect(state.resolved.approvalsReviewer).toBe('auto_review')
  expect(state.derivedPolicy.actionScopes?.read).toBe('allow')
  expect(state.derivedPolicy.actionScopes?.write).toBe('ask')
})

test('desktop permission modes exclude plan mode', () => {
  expect(DESKTOP_AGENT_PERMISSION_MODES).toEqual([
    'default',
    'auto-review',
    'full-access',
    'custom',
  ])
  expect(isDesktopAgentPermissionMode('plan')).toBe(false)
  expect(normalizeDesktopAgentPermissionMode('plan')).toBe('default')
})

test('createCodePilotXRuntimePermissionState: official sandbox_mode maps to builtin profiles', () => {
  const workspace = createCodePilotXRuntimePermissionState({
    projectConfig: { sandboxMode: 'workspace-write' },
    workspaceRoots: ['/repo'],
  })
  expect(workspace.resolved.defaultPermissions).toBe(':workspace')
  expect(workspace.derivedPolicy.sandboxMode).toBe('workspace-write')
  expect(workspace.sandboxOverlay.filesystem.allowWrite).toContain('/repo')

  const readOnly = createCodePilotXRuntimePermissionState({
    projectConfig: { sandboxMode: 'read-only' },
    workspaceRoots: ['/repo'],
  })
  expect(readOnly.resolved.defaultPermissions).toBe(':read-only')
  expect(readOnly.derivedPolicy.sandboxMode).toBe('read-only')

  const fullAccess = createCodePilotXRuntimePermissionState({
    projectConfig: { sandboxMode: 'danger-full-access' },
    workspaceRoots: ['/repo'],
  })
  expect(fullAccess.resolved.defaultPermissions).toBe(':danger-full-access')
  expect(fullAccess.derivedPolicy.sandboxMode).toBe('danger-full-access')
})

test('createCodePilotXRuntimePermissionState: workspace-write writable roots and reviewer aliases', () => {
  const state = createCodePilotXRuntimePermissionState({
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

test('createCodePilotXRuntimePermissionState: requirements have highest constraint', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
    defaultPermissions: ':danger-full-access',
    approvalPolicy: 'never',
  }
  const requirements: CodePilotXRequirementsPolicy = {
    defaultPermissions: ':workspace',
    allowedPermissionProfiles: [':workspace'],
    allowedApprovalPolicies: ['on-request', 'never'],
  }
  const state = createCodePilotXRuntimePermissionState({
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

test('createCodePilotXRuntimePermissionState: requirements reject invalid profiles', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
    defaultPermissions: ':danger-full-access',
  }
  const requirements: CodePilotXRequirementsPolicy = {
    allowedPermissionProfiles: [':read-only'],
  }
  expect(() =>
    createCodePilotXRuntimePermissionState({
      projectConfig,
      requirements,
      workspaceRoots: ['/repo'],
    }),
  ).toThrow('not allowed by requirements')
})

test('createCodePilotXRuntimePermissionState: sandbox overlay for :workspace profile', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
    defaultPermissions: ':workspace',
  }
  const state = createCodePilotXRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  expect(state.sandboxOverlay.filesystem.allowWrite).toContain('/repo')
  expect(state.sandboxOverlay.filesystem.denyRead).toEqual([])
  expect(state.sandboxOverlay.network.allowedDomains).toEqual([])
})

test('createCodePilotXRuntimePermissionState: sandbox overlay for :danger-full-access profile', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
    defaultPermissions: ':danger-full-access',
  }
  const state = createCodePilotXRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  // danger-full-access has no filesystem overlay restrictions
  expect(state.sandboxOverlay.filesystem.allowWrite).toEqual([])
  expect(state.sandboxOverlay.filesystem.denyWrite).toEqual([])
  // network domains still come through from the builtin profile config
  expect(state.sandboxOverlay.network.allowedDomains).toContain('*')
})

test('createCodePilotXRuntimePermissionState: sandbox overlay for :read-only profile', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
    defaultPermissions: ':read-only',
  }
  const state = createCodePilotXRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  expect(state.sandboxOverlay.filesystem.allowRead).toContain('/repo')
  expect(state.sandboxOverlay.filesystem.allowWrite).toEqual([])
})

test('createCodePilotXRuntimePermissionState: custom profile with filesystem deny rules', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
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
  const state = createCodePilotXRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  // extends :workspace so workspace roots are writable
  expect(state.sandboxOverlay.filesystem.allowWrite).toContain('/repo')
  expect(state.sandboxOverlay.filesystem.allowWrite).toContain('/tmp/custom-log')
  expect(state.sandboxOverlay.filesystem.denyWrite).toContain('**/*.secret')
  expect(state.sandboxOverlay.filesystem.denyRead).toContain('**/*.secret')
})

test('createCodePilotXRuntimePermissionState: custom profile with network domain rules', () => {
  const projectConfig: CodePilotXPermissionsConfig = {
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
  const state = createCodePilotXRuntimePermissionState({
    projectConfig,
    workspaceRoots: ['/repo'],
  })

  expect(state.sandboxOverlay.network.allowedDomains).toContain('api.example.com')
  expect(state.sandboxOverlay.network.deniedDomains).toContain('evil.test')
})

test('permissionPolicyForDesktopMode exposes official CodePilotX sandbox modes', () => {
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
  expect(permissionPolicyForDesktopMode('plan')).toMatchObject({
    profile: ':workspace',
    approvalMode: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write',
  })
  expect(permissionPolicyForDesktopMode('auto')).toMatchObject({
    approvalsReviewer: 'auto_review',
  })
})
