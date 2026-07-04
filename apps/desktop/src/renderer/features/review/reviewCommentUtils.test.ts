import { describe, expect, test } from 'bun:test'
import type { DesktopReviewComment } from '../../../shared/types.js'
import { buildCommentCountsByPath } from './reviewCommentUtils.js'

function comment(
  filePath: string,
  status: 'open' | 'resolved' = 'open',
): DesktopReviewComment {
  return {
    id: `${filePath}-${status}-${Math.random()}`,
    sessionId: 'sess_1',
    filePath,
    side: 'right',
    lineNumber: 1,
    lineContent: '',
    body: 'test comment',
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('buildCommentCountsByPath', () => {
  test('returns empty map for empty comments', () => {
    expect(buildCommentCountsByPath([])).toEqual({})
  })

  test('counts open comments per file path', () => {
    const comments = [
      comment('src/main.ts'),
      comment('src/main.ts'),
      comment('README.md'),
    ]
    const result = buildCommentCountsByPath(comments)
    expect(result['src/main.ts']).toBe(2)
    expect(result['README.md']).toBe(1)
  })

  test('aggregates comment counts into directory paths', () => {
    const comments = [
      comment('apps/desktop/src/main.ts'),
      comment('apps/desktop/src/renderer/app.tsx'),
    ]
    const result = buildCommentCountsByPath(comments)
    expect(result['apps/desktop/src/main.ts']).toBe(1)
    expect(result['apps/desktop/src/renderer/app.tsx']).toBe(1)
    expect(result['apps']).toBe(2)
    expect(result['apps/desktop']).toBe(2)
    expect(result['apps/desktop/src']).toBe(2)
  })

  test('excludes resolved comments from counts', () => {
    const comments = [
      comment('src/main.ts', 'open'),
      comment('src/main.ts', 'resolved'),
      comment('src/utils.ts', 'resolved'),
    ]
    const result = buildCommentCountsByPath(comments)
    expect(result['src/main.ts']).toBe(1)
    expect(result['src/utils.ts']).toBeUndefined()
  })

  test('handles root-level files without directory aggregation', () => {
    const comments = [
      comment('README.md'),
      comment('LICENSE'),
    ]
    const result = buildCommentCountsByPath(comments)
    expect(result['README.md']).toBe(1)
    expect(result['LICENSE']).toBe(1)
    // No directory keys for root-level files since segments.length <= 1
    expect(result['']).toBeUndefined()
  })
})
