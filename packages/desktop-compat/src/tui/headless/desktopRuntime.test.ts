import { expect, test } from 'bun:test'
import { sandboxPolicyForTurnSandboxMode } from './desktopRuntime.js'

test('workspace-write sandbox mode maps to v2 turn sandbox policy', () => {
  expect(sandboxPolicyForTurnSandboxMode('workspace-write')).toEqual({
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  })
})

test('read-only sandbox mode maps to v2 turn sandbox policy', () => {
  expect(sandboxPolicyForTurnSandboxMode('read-only')).toEqual({
    type: 'readOnly',
    networkAccess: false,
  })
})

test('danger-full-access sandbox mode maps to v2 turn sandbox policy', () => {
  expect(sandboxPolicyForTurnSandboxMode('danger-full-access')).toEqual({
    type: 'dangerFullAccess',
  })
})
