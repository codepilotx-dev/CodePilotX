import { expect, test } from 'bun:test'
import { buildInlineApprovalSummary } from './InlineApprovalCard.js'

test('buildInlineApprovalSummary uses file path and diff counts when available', () => {
  expect(
    buildInlineApprovalSummary({
      requestId: 'permission-1',
      toolName: 'Edit',
      description: 'Edit .gitignore',
      input: {
        file_path: '.gitignore',
        additions: 18,
        deletions: 0,
      },
    }),
  ).toEqual({
    label: '.gitignore',
    additions: 18,
    deletions: 0,
    accent: 'file',
  })
})

test('buildInlineApprovalSummary falls back to tool description', () => {
  expect(
    buildInlineApprovalSummary({
      requestId: 'permission-2',
      toolName: 'PowerShell',
      description: 'Run Get-ChildItem',
      input: {
        command: 'Get-ChildItem',
      },
    }),
  ).toEqual({
    label: 'Run Get-ChildItem',
    additions: null,
    deletions: null,
    accent: 'tool',
  })
})
