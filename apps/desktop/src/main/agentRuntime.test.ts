import { expect, test } from 'bun:test'
import {
  permissionModeArgs,
  permissionPromptToolArgs,
  permissionPromptToolName,
} from './agentRuntime.js'

test('permissionModeArgs maps desktop permission modes to CLI args', () => {
  expect(permissionModeArgs('default')).toEqual(['--permission-mode', 'default'])
  expect(permissionModeArgs('auto')).toEqual(['--permission-mode', 'auto'])
  expect(permissionModeArgs('bypassPermissions')).toEqual([
    '--dangerously-skip-permissions',
  ])
  expect(permissionModeArgs('customConfig')).toEqual([])
  expect(permissionModeArgs('plan')).toEqual(['--permission-mode', 'plan'])
  expect(permissionModeArgs(undefined)).toEqual([
    '--permission-mode',
    'default',
  ])
})

test('desktop runtimes use stdio permission prompt protocol', () => {
  expect(permissionPromptToolName()).toBe('stdio')
  expect(permissionPromptToolArgs()).toEqual([
    '--permission-prompt-tool',
    'stdio',
  ])
})
