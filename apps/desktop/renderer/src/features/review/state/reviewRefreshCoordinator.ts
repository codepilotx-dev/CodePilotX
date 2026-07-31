import type { DesktopReviewSource } from '../../../../shared/types.js'
import { reviewSourceKey } from '../source/reviewAgentClient.js'

export type ReviewRefreshResult = {
  cacheState: 'fresh' | 'stale'
}

export type ReviewRequestStamp = {
  identity: string
  generation: string
  requestId: number
}

type ReviewRefreshCycle<TResult> = {
  identity: string
  queuedForce: boolean
  promise: Promise<TResult | null>
}

export const REVIEW_REFRESH_MAX_ATTEMPTS = 3
export const REVIEW_REPOSITORY_BUSY_MESSAGE =
  '工作区持续变化，请稍后重试'

export class ReviewRepositoryBusyError extends Error {
  constructor() {
    super(REVIEW_REPOSITORY_BUSY_MESSAGE)
    this.name = 'ReviewRepositoryBusyError'
  }
}

export function isReviewRequestCurrent(
  request: ReviewRequestStamp,
  current: ReviewRequestStamp | null | undefined,
): boolean {
  return (
    current !== null &&
    current !== undefined &&
    request.identity === current.identity &&
    request.generation === current.generation &&
    request.requestId === current.requestId
  )
}

export function createReviewSummaryIdentity(
  projectId: string | null,
  workspacePath: string | null,
  source: DesktopReviewSource,
): string {
  return `${projectId ?? ''}\0${workspacePath ?? ''}\0${reviewSourceKey(source)}`
}

export function createReviewCommentIdentity(
  summaryIdentity: string,
  activeSessionId: string | null,
): string {
  return `${summaryIdentity}\0${activeSessionId ?? ''}`
}

export function reviewGitChangeMatchesProject(
  detail: unknown,
  projectId: string | null,
): boolean {
  return (
    typeof projectId === 'string' &&
    projectId.length > 0 &&
    typeof detail === 'object' &&
    detail !== null &&
    'projectId' in detail &&
    detail.projectId === projectId
  )
}

/**
 * Serializes summary refreshes for the active source. A force request arriving
 * during an active request, or a stale result, schedules exactly one trailing
 * force refresh so the view eventually converges without parallel Git scans.
 */
export class ReviewRefreshCoordinator<
  TResult extends ReviewRefreshResult,
> {
  #current: ReviewRefreshCycle<TResult> | null = null
  #disposed = false
  readonly #maxAttempts: number

  constructor(maxAttempts = REVIEW_REFRESH_MAX_ATTEMPTS) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError('maxAttempts must be a positive integer')
    }
    this.#maxAttempts = maxAttempts
  }

  request(
    identity: string,
    force: boolean,
    execute: (force: boolean) => Promise<TResult | null>,
  ): Promise<TResult | null> {
    if (this.#disposed) return Promise.resolve(null)

    const active = this.#current
    if (active?.identity === identity) {
      if (force) active.queuedForce = true
      return active.promise
    }

    const cycle: ReviewRefreshCycle<TResult> = {
      identity,
      queuedForce: false,
      promise: Promise.resolve<TResult | null>(null),
    }
    this.#current = cycle
    cycle.promise = this.#runCycle(cycle, force, execute)
    return cycle.promise
  }

  invalidate(identity?: string): void {
    if (!identity || this.#current?.identity === identity) {
      this.#current = null
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#current = null
  }

  async #runCycle(
    cycle: ReviewRefreshCycle<TResult>,
    initialForce: boolean,
    execute: (force: boolean) => Promise<TResult | null>,
  ): Promise<TResult | null> {
    let force = initialForce
    let result: TResult | null = null
    let attempts = 0

    while (!this.#disposed && this.#current === cycle) {
      attempts += 1
      cycle.queuedForce = false
      try {
        result = await execute(force)
      } catch (error) {
        if (this.#current === cycle) this.#current = null
        throw error
      }
      if (result?.cacheState === 'stale') cycle.queuedForce = true
      if (!cycle.queuedForce || this.#current !== cycle) break
      if (attempts >= this.#maxAttempts) {
        if (this.#current === cycle) this.#current = null
        throw new ReviewRepositoryBusyError()
      }
      force = true
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }

    if (this.#current === cycle) this.#current = null
    return result
  }
}
