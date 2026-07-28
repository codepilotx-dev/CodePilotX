import { describe, expect, test } from 'bun:test'
import { AgentRpcError } from '../src/services/agentRpcClient.js'
import {
  pickDefaultReviewBaseBranch,
  retainCurrentReviewFileDiffs,
  ReviewFileRequestCoordinator,
  reviewLoadStateForError,
} from '../src/features/review/source/reviewAgentClient.js'
import { formatReviewCount } from '../src/features/review/diff/reviewFormat.js'
import type {
  ReviewFileDiff,
  ReviewFileSummary,
  ReviewSummarySnapshot,
} from '../src/features/review/source/reviewAgentClient.js'

describe('review load state', () => {
  test('审阅统计使用精确千分位而不是截断为 999+', () => {
    expect(formatReviewCount(3344)).toBe('3,344')
    expect(formatReviewCount(626)).toBe('626')
    expect(formatReviewCount(-1)).toBe('0')
  })

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

  test('分支来源优先选择远端主分支并在单分支仓库回退当前分支', () => {
    expect(
      pickDefaultReviewBaseBranch([
        { name: 'feature/review', sha: '1', current: true, remote: false },
        { name: 'origin/main', sha: '2', current: false, remote: true },
        { name: 'origin/feature/review', sha: '1', current: false, remote: true },
      ]),
    ).toBe('origin/main')
    expect(
      pickDefaultReviewBaseBranch([
        { name: 'main', sha: '1', current: true, remote: false },
      ]),
    ).toBe('main')
    expect(pickDefaultReviewBaseBranch([])).toBeNull()
  })

  test('摘要刷新只丢弃 revision 已变化或已删除文件的 Diff', () => {
    const stable = reviewFileDiff(reviewFileSummary('stable.ts', 'rev-1'))
    const changed = reviewFileDiff(reviewFileSummary('changed.ts', 'rev-1'))
    const deleted = reviewFileDiff(reviewFileSummary('deleted.ts', 'rev-1'))
    const retained = retainCurrentReviewFileDiffs(
      reviewSummary([
        reviewFileSummary('stable.ts', 'rev-1'),
        reviewFileSummary('changed.ts', 'rev-2'),
        reviewFileSummary('new.ts', 'rev-1'),
      ]),
      new Map([
        ['stable.ts', stable],
        ['changed.ts', changed],
        ['deleted.ts', deleted],
      ]),
    )

    expect([...retained.keys()]).toEqual(['stable.ts'])
    expect(retained.get('stable.ts')).toBe(stable)
  })

  test('文件加载合并相同请求，并将并发限制为 2', async () => {
    const coordinator = new ReviewFileRequestCoordinator(2)
    let active = 0
    let peak = 0
    let firstRunCount = 0
    const started: string[] = []
    const releases: Array<() => void> = []
    const task = (onRun?: () => void) => async (): Promise<void> => {
      onRun?.()
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => releases.push(resolve))
      active -= 1
    }

    const first = coordinator.schedule(
      'generation:path-a:standard',
      task(() => {
        firstRunCount += 1
        started.push('a')
      }),
      'selected',
    )
    const duplicate = coordinator.schedule(
      'generation:path-a:standard',
      task(() => {
        firstRunCount += 1
      }),
    )
    const second = coordinator.schedule(
      'generation:path-b:standard',
      task(() => started.push('b')),
    )
    const third = coordinator.schedule(
      'generation:path-c:standard',
      task(() => started.push('c')),
    )
    const fourth = coordinator.schedule(
      'generation:path-d:standard',
      task(() => started.push('d')),
    )
    const promoted = coordinator.schedule(
      'generation:path-d:standard',
      task(() => started.push('duplicate-d')),
      'selected',
    )

    await Promise.resolve()
    expect(first).toBe(duplicate)
    expect(fourth).toBe(promoted)
    expect(firstRunCount).toBe(1)
    expect(active).toBe(2)
    expect(peak).toBe(2)

    releases.shift()?.()
    await Bun.sleep(0)
    expect(active).toBe(2)
    expect(peak).toBe(2)
    expect(started[2]).toBe('d')

    while (active > 0 || releases.length > 0) {
      while (releases.length > 0) releases.shift()?.()
      await Bun.sleep(0)
    }
    await Promise.all([first, duplicate, second, third, fourth, promoted])
  })
})

function reviewFileSummary(path: string, revision: string): ReviewFileSummary {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changedLines: 2,
    changedBytes: 16,
    binary: false,
    revision,
  }
}

function reviewFileDiff(file: ReviewFileSummary): ReviewFileDiff {
  return {
    file,
    revision: file.revision,
    patch: '',
    hunks: [],
    renderable: true,
    tooLargeReason: null,
  }
}

function reviewSummary(files: ReviewFileSummary[]): ReviewSummarySnapshot {
  return {
    projectId: 'project-1',
    generation: 'generation-2',
    source: { kind: 'unstaged' },
    repositoryRoot: 'C:\\workspace',
    headSha: 'head',
    baseSha: 'base',
    files,
    totals: {
      files: files.length,
      additions: 0,
      deletions: 0,
      changedLines: 0,
      changedBytes: 0,
    },
    largeDiffMode: false,
  }
}
