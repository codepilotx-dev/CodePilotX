import { describe, expect, test } from 'bun:test'

import {
  clampThreadScrollOffset,
  createThreadScrollStateCache,
  distanceFromThreadBottom,
  isProgrammaticScrollActive,
  LATEST_TURN_PLACEMENT_THRESHOLD_PX,
  resolveThreadScrollMode,
  scrollOffsetForThreadBottomDistance,
  THREAD_BOTTOM_THRESHOLD_PX,
} from '../src/features/session/conversation/useThreadScrollController.js'

describe('thread scroll controller', () => {
  test('computes and clamps distance from the bottom', () => {
    expect(
      distanceFromThreadBottom({
        scrollOffset: 700,
        scrollSize: 1_000,
        viewportSize: 280,
      }),
    ).toBe(20)
    expect(
      distanceFromThreadBottom({
        scrollOffset: 900,
        scrollSize: 1_000,
        viewportSize: 280,
      }),
    ).toBe(0)
    expect(THREAD_BOTTOM_THRESHOLD_PX).toBe(24)
  })

  test('restores an offset while preserving distance from the bottom', () => {
    expect(
      scrollOffsetForThreadBottomDistance(
        { scrollSize: 1_000, viewportSize: 280 },
        600,
      ),
    ).toBe(120)
    expect(
      scrollOffsetForThreadBottomDistance(
        { scrollSize: 1_000, viewportSize: 280 },
        900,
      ),
    ).toBe(0)
    expect(
      clampThreadScrollOffset(
        { scrollSize: 1_000, viewportSize: 280 },
        900,
      ),
    ).toBe(720)
    expect(
      clampThreadScrollOffset(
        { scrollSize: 100, viewportSize: 280 },
        20,
      ),
    ).toBe(0)
  })

  test('bounds saved thread positions by lru capacity and ttl', () => {
    let timestamp = 0
    const cache = createThreadScrollStateCache({
      capacity: 2,
      now: () => timestamp,
      ttlMs: 100,
    })
    const saved = {
      distanceFromBottom: 50,
      mode: 'static' as const,
      scrollOffset: 200,
    }
    cache.set('a', saved)
    timestamp = 1
    cache.set('b', saved)
    expect(cache.get('a')).toBe(saved)
    timestamp = 2
    cache.set('c', saved)
    expect(cache.get('b')).toBeNull()
    expect(cache.size()).toBe(2)

    timestamp = 101
    expect(cache.get('a')).toBeNull()
    expect(cache.get('c')).toBe(saved)
    timestamp = 201
    expect(cache.get('c')).toBeNull()
  })

  test('stops following when the user scrolls upward', () => {
    expect(
      resolveThreadScrollMode({
        mode: 'prework_follow',
        active: true,
        atBottom: false,
        userScrolledUp: true,
        contentChanged: true,
      }),
    ).toEqual({ mode: 'static', hasNewContent: true })
  })

  test('does not classify a protected programmatic jump as user scrolling', () => {
    expect(isProgrammaticScrollActive(1_000, 1_140)).toBe(true)
    expect(isProgrammaticScrollActive(1_141, 1_140)).toBe(false)

    expect(
      resolveThreadScrollMode({
        mode: 'prework_follow',
        active: true,
        atBottom: false,
        userScrolledUp: false,
        contentChanged: false,
      }),
    ).toEqual({ mode: 'prework_follow', hasNewContent: false })
  })

  test('keeps prework watch stable until placement is evaluated', () => {
    expect(LATEST_TURN_PLACEMENT_THRESHOLD_PX).toBe(300)
    expect(
      resolveThreadScrollMode({
        mode: 'prework_watch',
        active: true,
        atBottom: false,
        userScrolledUp: false,
        contentChanged: false,
      }),
    ).toEqual({ mode: 'prework_watch', hasNewContent: false })
  })

  test('keeps a static reader in place when streaming content grows', () => {
    expect(
      resolveThreadScrollMode({
        mode: 'static',
        active: true,
        atBottom: false,
        userScrolledUp: false,
        contentChanged: true,
      }),
    ).toEqual({ mode: 'static', hasNewContent: true })
  })

  test('manual return enters user follow and reaching the bottom resumes follow', () => {
    expect(
      resolveThreadScrollMode({
        mode: 'static',
        active: true,
        atBottom: true,
        userScrolledUp: false,
        contentChanged: false,
        explicitFollow: true,
      }),
    ).toEqual({ mode: 'user_follow', hasNewContent: false })

    expect(
      resolveThreadScrollMode({
        mode: 'static',
        active: true,
        atBottom: true,
        userScrolledUp: false,
        contentChanged: false,
      }),
    ).toEqual({ mode: 'prework_follow', hasNewContent: false })
  })

  test('inactive threads always settle to static', () => {
    expect(
      resolveThreadScrollMode({
        mode: 'user_follow',
        active: false,
        atBottom: true,
        userScrolledUp: false,
        contentChanged: true,
      }),
    ).toEqual({ mode: 'static', hasNewContent: false })
  })
})
