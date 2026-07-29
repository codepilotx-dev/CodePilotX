import { describe, expect, test } from 'bun:test'
import {
  createReviewCommentIdentity,
  createReviewSummaryIdentity,
  isReviewRequestCurrent,
  reviewGitChangeMatchesProject,
  REVIEW_REPOSITORY_BUSY_MESSAGE,
  ReviewRefreshCoordinator,
} from '../src/features/review/state/reviewRefreshCoordinator.js'

describe('ReviewRefreshCoordinator', () => {
  test('stale 结果会排队一次 force 刷新并以 fresh 结果收敛', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh' | 'stale'
      generation: string
    }>()
    const forces: boolean[] = []

    const result = await coordinator.request('project:unstaged', false, force => {
      forces.push(force)
      return Promise.resolve(
        forces.length === 1
          ? { cacheState: 'stale', generation: 'old' }
          : { cacheState: 'fresh', generation: 'new' },
      )
    })

    expect(forces).toEqual([false, true])
    expect(result?.generation).toBe('new')
  })

  test('运行中的多个 force 事件只合并为一个尾随请求', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh' | 'stale'
      generation: string
    }>()
    const forces: boolean[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const execute = async (force: boolean) => {
      forces.push(force)
      if (forces.length === 1) await firstBlocked
      return {
        cacheState: 'fresh' as const,
        generation: `generation-${forces.length}`,
      }
    }

    const first = coordinator.request('project:unstaged', false, execute)
    const second = coordinator.request('project:unstaged', true, execute)
    const third = coordinator.request('project:unstaged', true, execute)
    expect(second).toBe(first)
    expect(third).toBe(first)

    releaseFirst()
    const result = await first

    expect(forces).toEqual([false, true])
    expect(result?.generation).toBe('generation-2')
  })

  test('持续 stale 最多刷新三次并返回 repository busy', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh' | 'stale'
      generation: string
    }>()
    const forces: boolean[] = []

    await expect(
      coordinator.request('project:unstaged', false, force => {
        forces.push(force)
        return Promise.resolve({
          cacheState: 'stale' as const,
          generation: `generation-${forces.length}`,
        })
      }),
    ).rejects.toThrow(REVIEW_REPOSITORY_BUSY_MESSAGE)

    expect(forces).toEqual([false, true, true])
  })

  test('文件请求必须同时匹配 identity、generation 和 requestId', () => {
    const current = {
      identity: 'project:unstaged',
      generation: 'generation-2',
      requestId: 9,
    }

    expect(isReviewRequestCurrent({ ...current }, current)).toBe(true)
    expect(
      isReviewRequestCurrent({ ...current, identity: 'project:staged' }, current),
    ).toBe(false)
    expect(
      isReviewRequestCurrent({ ...current, generation: 'generation-1' }, current),
    ).toBe(false)
    expect(
      isReviewRequestCurrent({ ...current, requestId: 8 }, current),
    ).toBe(false)
  })

  test('identity 包含项目、工作区、来源和评论会话', () => {
    const summary = createReviewSummaryIdentity(
      'project-1',
      'C:\\workspace',
      { kind: 'pull-request', owner: 'acme', repository: 'app', number: 7 },
    )

    expect(summary).toContain('project-1')
    expect(summary).toContain('C:\\workspace')
    expect(summary).toContain('pull-request:acme/app#7')
    expect(createReviewCommentIdentity(summary, 'thread-1')).toEndWith(
      '\0thread-1',
    )
  })

  test('Git 事件只刷新同一 projectId', () => {
    expect(
      reviewGitChangeMatchesProject({ projectId: 'project-1' }, 'project-1'),
    ).toBe(true)
    expect(
      reviewGitChangeMatchesProject({ projectId: 'project-2' }, 'project-1'),
    ).toBe(false)
    expect(reviewGitChangeMatchesProject({}, 'project-1')).toBe(false)
    expect(
      reviewGitChangeMatchesProject({ projectId: 'project-1' }, null),
    ).toBe(false)
  })
})
