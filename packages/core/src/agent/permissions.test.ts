import { expect, test } from 'bun:test'
import {
  normalizeDesktopAgentPermissionMode,
  permissionPolicyForDesktopMode,
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
  })
  expect(permissionPolicyForDesktopMode('auto')).toEqual({
    profile: 'workspace-write',
    approvalMode: 'auto-review',
  })
  expect(permissionPolicyForDesktopMode('bypassPermissions')).toEqual({
    profile: 'danger-full-access',
    approvalMode: 'bypass',
  })
  expect(permissionPolicyForDesktopMode('customConfig')).toEqual({
    profile: 'workspace-write',
    approvalMode: 'config',
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
