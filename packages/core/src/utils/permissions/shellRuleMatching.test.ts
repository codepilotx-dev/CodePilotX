import { expect, test } from 'bun:test'
import {
  matchWildcardPattern,
  parsePermissionRule,
  permissionRuleExtractPrefix,
  suggestionForExactCommand,
  suggestionForPrefix,
} from './shellRuleMatching.js'
import { getRuleBehaviorDescription } from './PermissionResult.js'

test('parses exact, prefix, and wildcard permission rules', () => {
  expect(parsePermissionRule('npm test')).toEqual({
    type: 'exact',
    command: 'npm test',
  })
  expect(parsePermissionRule('npm:*')).toEqual({
    type: 'prefix',
    prefix: 'npm',
  })
  expect(parsePermissionRule('git *')).toEqual({
    type: 'wildcard',
    pattern: 'git *',
  })
})

test('matches wildcard permission rules with escapes and optional trailing args', () => {
  expect(matchWildcardPattern('git *', 'git')).toBe(true)
  expect(matchWildcardPattern('git *', 'git status')).toBe(true)
  expect(matchWildcardPattern('echo \\*', 'echo *')).toBe(true)
  expect(matchWildcardPattern('ECHO *', 'echo hello', true)).toBe(true)
})

test('builds shell permission suggestions without tui dependencies', () => {
  expect(permissionRuleExtractPrefix('npm:*')).toBe('npm')
  expect(suggestionForExactCommand('Bash', 'npm test')).toEqual([
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test' }],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ])
  expect(suggestionForPrefix('Bash', 'npm')).toEqual([
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ])
})

test('describes permission result behavior', () => {
  expect(getRuleBehaviorDescription('allow')).toBe('allowed')
  expect(getRuleBehaviorDescription('deny')).toBe('denied')
  expect(getRuleBehaviorDescription('ask')).toBe('asked for confirmation for')
})
