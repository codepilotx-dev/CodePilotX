import { expect, test } from 'bun:test'
import {
  normalizeAgentPermissionPolicy,
  normalizeDesktopAgentPermissionMode,
  permissionPolicyForDesktopMode,
  resolvePermissionEffect,
  shouldPromptForPermission,
} from './permissions.js'

test('legacy desktop permission modes migrate to the current four modes', () => {
  expect(normalizeDesktopAgentPermissionMode('acceptEdits')).toBe('auto')
  expect(normalizeDesktopAgentPermissionMode('dontAsk')).toBe('customConfig')
  expect(normalizeDesktopAgentPermissionMode('default')).toBe('default')
  expect(normalizeDesktopAgentPermissionMode('bypassPermissions')).toBe(
    'bypassPermissions',
  )
  expect(normalizeDesktopAgentPermissionMode(undefined)).toBe('default')
})

test('desktop permission modes map to shared policies', () => {
  expect(permissionPolicyForDesktopMode('default')).toEqual({
    profile: 'workspace-write',
    approvalMode: 'prompt',
    sandboxPolicy: 'workspace-write',
  })
  expect(permissionPolicyForDesktopMode('auto')).toEqual({
    profile: 'workspace-write',
    approvalMode: 'auto-review',
    sandboxPolicy: 'workspace-write',
  })
  expect(permissionPolicyForDesktopMode('bypassPermissions')).toEqual({
    profile: 'danger-full-access',
    approvalMode: 'bypass',
    sandboxPolicy: 'danger-full-access',
  })
  expect(permissionPolicyForDesktopMode('customConfig')).toEqual({
    profile: 'workspace-write',
    approvalMode: 'config',
    sandboxPolicy: 'workspace-write',
  })
})

test('default policy prompts for mutating local agent actions', () => {
  const policy = permissionPolicyForDesktopMode('default')

  expect(shouldPromptForPermission(policy, 'read')).toBe(false)
  expect(shouldPromptForPermission(policy, 'write')).toBe(true)
  expect(shouldPromptForPermission(policy, 'shell')).toBe(true)
  expect(shouldPromptForPermission(policy, 'network')).toBe(true)
  expect(shouldPromptForPermission(policy, 'mcp')).toBe(true)
})

test('read-only profile blocks non-read actions through the permission gate', () => {
  const policy = {
    profile: 'read-only',
    approvalMode: 'prompt',
  } as const

  expect(shouldPromptForPermission(policy, 'read')).toBe(false)
  expect(shouldPromptForPermission(policy, 'write')).toBe(true)
  expect(shouldPromptForPermission(policy, 'shell')).toBe(true)
})

test('permission policy normalization fills Codex-style session fields', () => {
  expect(normalizeAgentPermissionPolicy(undefined)).toEqual({
    profile: 'workspace-write',
    approvalMode: 'prompt',
    sandboxPolicy: 'workspace-write',
  })

  expect(
    normalizeAgentPermissionPolicy({
      profile: 'danger-full-access',
      approvalMode: 'bypass',
    }),
  ).toEqual({
    profile: 'danger-full-access',
    approvalMode: 'bypass',
    sandboxPolicy: 'danger-full-access',
  })
})

test('permission effect resolution supports action scopes and per-tool overrides', () => {
  const policy = normalizeAgentPermissionPolicy({
    profile: 'workspace-write',
    approvalMode: 'prompt',
    actionScopes: {
      network: 'deny',
      shell: 'ask',
    },
    toolOverrides: {
      WebFetch: { network: 'allow' },
      Bash: { shell: 'deny' },
    },
  })

  expect(resolvePermissionEffect(policy, 'read')).toBe('allow')
  expect(resolvePermissionEffect(policy, 'write')).toBe('ask')
  expect(resolvePermissionEffect(policy, 'network')).toBe('deny')
  expect(resolvePermissionEffect(policy, 'network', 'WebFetch')).toBe('allow')
  expect(resolvePermissionEffect(policy, 'shell', 'Bash')).toBe('deny')
  expect(shouldPromptForPermission(policy, 'network')).toBe(false)
  expect(shouldPromptForPermission(policy, 'shell')).toBe(true)
  expect(shouldPromptForPermission(policy, 'shell', 'Bash')).toBe(false)
})

test('bypass approval mode still allows every action before local tool rules', () => {
  const policy = normalizeAgentPermissionPolicy({
    profile: 'danger-full-access',
    approvalMode: 'bypass',
    actionScopes: { shell: 'deny' },
    toolOverrides: { Bash: { shell: 'deny' } },
  })

  expect(resolvePermissionEffect(policy, 'shell', 'Bash')).toBe('allow')
  expect(shouldPromptForPermission(policy, 'shell', 'Bash')).toBe(false)
})
