import { expect, test } from 'bun:test'
import { sanitizePathComponent } from '../pathComponent.js'
import {
  _resetTaskOutputDirForTest,
  getTaskOutputDir,
  getTaskOutputPath,
} from './diskOutput.js'

test('sanitizePathComponent replaces path-illegal characters with hyphens', () => {
  expect(sanitizePathComponent('parent:auto-review:uuid')).toBe(
    'parent-auto-review-uuid',
  )
  expect(sanitizePathComponent('../../bad\\id')).toBe('------bad-id')
  expect(sanitizePathComponent('normal-uuid-123')).toBe('normal-uuid-123')
  expect(sanitizePathComponent('')).toBe('')
})

test('getTaskOutputDir ends with tasks segment', () => {
  _resetTaskOutputDirForTest()
  const dir = getTaskOutputDir()
  // The dir ends with /tasks (posix) or \\tasks (windows)
  expect(dir.endsWith('tasks') || dir.endsWith('tasks\\')).toBe(true)
})

test('getTaskOutputPath sanitizes task id in filename', () => {
  _resetTaskOutputDirForTest()
  const path = getTaskOutputPath('agent:../../bad\\id')
  // Should end with .output
  expect(path.endsWith('.output')).toBe(true)
  // The filename portion should not contain path-illegal chars
  // (drive letter colon in absolute path prefix is expected)
  const normalized = path.replace(/\\/g, '/')
  const filename = normalized.split('/').pop() ?? ''
  expect(filename).not.toContain(':')
  expect(filename).not.toContain('..')
  expect(filename).not.toContain('\\')
  // Should be inside the task output directory
  const dir = getTaskOutputDir().replace(/\\/g, '/')
  expect(normalized.startsWith(dir)).toBe(true)
})
