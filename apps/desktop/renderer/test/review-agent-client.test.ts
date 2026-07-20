import { describe, expect, test } from 'bun:test'
import { AgentRpcError } from '../src/services/agentRpcClient.js'
import { reviewLoadStateForError } from '../src/features/review/reviewAgentClient.js'

describe('review load state', () => {
  test('区分非仓库、过期快照、能力缺失和普通错误', () => {
    expect(
      reviewLoadStateForError(
        new AgentRpcError('不是 Git 仓库', -32_000, {
          code: 'REPOSITORY_NOT_FOUND',
        }),
      ),
    ).toBe('not-repository')
    expect(
      reviewLoadStateForError(
        new AgentRpcError('快照过期', -32_000, {
          code: 'REVIEW_SNAPSHOT_EXPIRED',
        }),
      ),
    ).toBe('stale')
    expect(
      reviewLoadStateForError(
        new AgentRpcError('能力不可用', -32_000, {
          code: 'CAPABILITY_REQUIRED',
        }),
      ),
    ).toBe('unsupported')
    expect(reviewLoadStateForError(new Error('网络中断'))).toBe('error')
  })
})
