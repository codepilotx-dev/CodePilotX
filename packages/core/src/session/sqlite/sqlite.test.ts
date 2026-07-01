import { expect, test } from 'bun:test'
import { normalizeSearchTerm } from './queries.js'
import { normalizeUpsert } from './sync.js'

test('normalizeUpsert preserves explicit created_at_ms input shape', () => {
  const normalized = normalizeUpsert(
    {
      id: 's1',
      project_path: '/repo',
      transcript_path: '/repo/s1.jsonl',
      created_at_ms: 100,
      updated_at_ms: 200,
      title: 'Initial title',
      preview: 'Initial preview',
    },
    undefined,
  )

  expect(normalized.created_at_ms).toBe(100)
  expect(normalized.preview).toBe('Initial preview')
})

test('normalizeUpsert accepts later metadata without changing SQL preservation contract', () => {
  const normalized = normalizeUpsert(
    {
    id: 's1',
    project_path: '/repo',
    transcript_path: '/repo/s1.jsonl',
    created_at_ms: 500,
    updated_at_ms: 600,
    title: 'Updated title',
    preview: 'Updated preview',
    },
    { created_at_ms: 100, preview: 'Initial preview' },
  )

  expect(normalized.created_at_ms).toBe(500)
  expect(normalized.updated_at_ms).toBe(600)
})

test('normalizeSearchTerm makes search case-insensitive', () => {
  expect(normalizeSearchTerm('Memory Design')).toBe('memory design')
})
