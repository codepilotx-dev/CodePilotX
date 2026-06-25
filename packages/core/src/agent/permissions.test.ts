import { expect, test } from 'bun:test'
import {
  BUILTIN_CODEX_PERMISSION_PROFILES,
  evaluateFilesystemAccess,
  evaluateNetworkDomainAccess,
  resolveCodexPermissions,
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
