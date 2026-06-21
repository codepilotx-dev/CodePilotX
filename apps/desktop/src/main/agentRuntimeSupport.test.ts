import { expect, test } from 'bun:test'
import { buildToolResultMetadata } from './agentRuntimeSupport.js'

test('buildToolResultMetadata preserves string tool result content', () => {
  expect(buildToolResultMetadata('Read failed: file not found')).toEqual({
    content: 'Read failed: file not found',
    result: 'Read failed: file not found',
  })
})

test('buildToolResultMetadata extracts text block tool result content', () => {
  expect(
    buildToolResultMetadata([
      { type: 'text', text: 'Glob failed' },
      { type: 'text', text: 'rg not found' },
    ]),
  ).toEqual({
    content: 'Glob failed\nrg not found',
    result: [
      { type: 'text', text: 'Glob failed' },
      { type: 'text', text: 'rg not found' },
    ],
  })
})

test('buildToolResultMetadata preserves common structured output fields', () => {
  expect(
    buildToolResultMetadata({
      stderr: 'command failed',
      stdout: 'partial output',
      output: [{ text: 'usage: rg' }],
    }),
  ).toEqual({
    stderr: 'command failed',
    stdout: 'partial output',
    output: 'usage: rg',
    result: {
      stderr: 'command failed',
      stdout: 'partial output',
      output: [{ text: 'usage: rg' }],
    },
  })
})
