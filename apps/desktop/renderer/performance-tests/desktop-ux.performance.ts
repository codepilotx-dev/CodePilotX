import { expect, test } from '@playwright/test'
import {
  measurePerformanceThreadSwitch,
  nearestRankP95,
  recordRendererSample,
  startInteractionProbe,
  stopInteractionProbe,
  waitForFixture,
  waitForPerformanceThread,
} from './performance-test-helpers.js'

test.describe('desktop UX performance', () => {
  test('sidebar resize commits storage once after pointer release', async ({ page }) => {
    await page.addInitScript(() => {
      const target = window as typeof window & {
        __sidebarWidthWrites?: number
      }
      target.__sidebarWidthWrites = 0
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'layout.sidebarWidth') {
          target.__sidebarWidthWrites = (target.__sidebarWidthWrites ?? 0) + 1
        }
        return original.call(this, key, value)
      }
    })
    await waitForFixture(page, 100, 30)
    const handle = page.locator('.sidebar-resizer')
    await expect(handle).toBeVisible()
    await performSidebarDrag(page, handle, 10, true)
    await settlePage(page)

    for (let sample = 1; sample <= 3; sample += 1) {
      await page.evaluate(() => {
        ;(window as typeof window & { __sidebarWidthWrites?: number })
          .__sidebarWidthWrites = 0
      })
      await startInteractionProbe(page)
      await performSidebarDrag(page, handle, 60, false)
      const writesDuringDrag = await page.evaluate(
        () =>
          (window as typeof window & { __sidebarWidthWrites?: number })
            .__sidebarWidthWrites ?? 0,
      )
      await page.mouse.up()
      const interaction = await stopInteractionProbe(page)
      const writesAfterDrop = await page.evaluate(
        () =>
          (window as typeof window & { __sidebarWidthWrites?: number })
            .__sidebarWidthWrites ?? 0,
      )
      await recordRendererSample(page, 'sidebar-resize', sample, {
        ...interaction,
        writesAfterDrop,
        writesDuringDrag,
      })
    }
  })

  test('long conversation scrolling remains virtualized', async ({ page }) => {
    await waitForFixture(page, 250, 30)
    const scrollArea = page.locator('.workflow-main-scroll-area')
    await expect(scrollArea).toBeVisible()
    await scrollTimeline(scrollArea)

    for (let sample = 1; sample <= 3; sample += 1) {
      await startInteractionProbe(page)
      await scrollTimeline(scrollArea)
      const interaction = await stopInteractionProbe(page)
      const mountedTurns = await page.locator('[data-turn-navigation-id]').count()
      await recordRendererSample(page, 'timeline-scroll', sample, {
        ...interaction,
        mountedTurns,
      })
    }
  })

  test('cold and cached session switches remove stale content', async ({ page }) => {
    await waitForFixture(page, 100, 30)

    for (let targetIndex = 2; targetIndex <= 30; targetIndex += 1) {
      const switchMetrics = await measurePerformanceThreadSwitch(
        page,
        targetIndex - 1,
        targetIndex,
        10,
        false,
      )
      await recordRendererSample(page, 'cold-switch', targetIndex - 1, {
        readyMs: switchMetrics.readyMs,
        staleVisibleMs: switchMetrics.staleVisibleMs,
      })
    }

    await page.evaluate(() => {
      location.hash = '#/threads/performance-session-001'
    })
    await waitForPerformanceThread(page, 1, 100)
    await page.evaluate(() => {
      location.hash = '#/threads/performance-session-002'
    })
    await waitForPerformanceThread(page, 2, 10)

    const cachedSwitch = await measurePerformanceThreadSwitch(
      page,
      2,
      1,
      100,
      false,
    )
    await recordRendererSample(page, 'cached-switch', 1, {
      cachedContentMs: cachedSwitch.contentVisibleMs,
      readyMs: cachedSwitch.readyMs,
    })
  })

  test('composer input remains responsive in a long conversation', async ({ page }) => {
    await waitForFixture(page, 500, 30)

    for (let sample = 1; sample <= 3; sample += 1) {
      await page.evaluate(() => {
        location.hash = '#/threads/performance-session-002'
      })
      await waitForPerformanceThread(page, 2, 10)
      const shortP95 = await measureComposerInput(page)
      await page.evaluate(() => {
        location.hash = '#/threads/performance-session-001'
      })
      await waitForPerformanceThread(page, 1, 500)
      const longP95 = await measureComposerInput(page)
      // Sub-frame headless rAF timings fluctuate by fractions of a frame.
      // Normalize the paired regression to one 60 Hz frame so the relative
      // budget detects user-visible degradation instead of timer phase noise.
      await recordRendererSample(page, 'composer-input', sample, {
        inputToPaintP95Ms: longP95,
        relativeDegradationPercent:
          ((longP95 - shortP95) / Math.max(1000 / 60, shortP95)) * 100,
      })
    }
  })

  test('heap remains bounded across fifty session switches', async ({ page }) => {
    await waitForFixture(page, 10, 50)
    const before = await collectHeapAfterGc(page)
    for (let index = 1; index <= 50; index += 1) {
      await page.evaluate(threadIndex => {
        location.hash = `#/threads/performance-session-${String(threadIndex).padStart(3, '0')}`
      }, index)
      await waitForPerformanceThread(page, index, 10)
    }
    const after = await collectHeapAfterGc(page)
    const heapDeltaBytes = after - before
    const heapDeltaPercent = (heapDeltaBytes / Math.max(1, before)) * 100
    await recordRendererSample(page, 'memory-stability', 1, {
      heapDeltaMiB: heapDeltaBytes / 1024 / 1024,
      heapDeltaPercent,
      heapRegressionScore:
        heapDeltaPercent > 25 && heapDeltaBytes > 25 * 1024 * 1024 ? 1 : 0,
    })
  })

  test('sidebar drag and drop settles without rebuilding the full catalog', async ({
    page,
  }) => {
    await waitForFixture(page, 10, 50)
    const rows = page.locator('.sidebar-session-row[draggable="true"]')
    if (await rows.count() === 0) {
      await page.locator('[data-sidebar-section-id="recent"]').click()
    }
    await expect(rows.first()).toBeVisible()
    const showMore = page.getByRole('button', { name: '展开显示' })
    while (await rows.count() < 50 && await showMore.count() > 0) {
      await showMore.first().click()
    }
    expect(await rows.count()).toBe(50)
    await measureSidebarDrop(page, rows.nth(0), rows.nth(1))
    await settlePage(page)

    for (let sample = 1; sample <= 3; sample += 1) {
      const source = rows.nth(sample % 2)
      const target = rows.nth((sample + 1) % 2)
      const dropMetrics = await measureSidebarDrop(page, source, target)
      await recordRendererSample(page, 'sidebar-dnd', sample, {
        ...dropMetrics,
      })
    }
  })
})

async function measureComposerInput(
  page: import('@playwright/test').Page,
): Promise<number> {
  const editor = page.locator('.composer-editor-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  const latencies: number[] = []
  for (const character of 'CodePilotX-performance-input-response-0123456789-abcdefghij') {
    await page.evaluate(() => {
      const targetWindow = window as typeof window & {
        __codePilotXInputPaint?: Promise<number>
      }
      targetWindow.__codePilotXInputPaint = new Promise(resolve => {
        document.addEventListener(
          'input',
          () => {
            const startedAt = performance.now()
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve(performance.now() - startedAt),
              ),
            )
          },
          { capture: true, once: true },
        )
      })
    })
    await page.keyboard.type(character)
    latencies.push(
      await page.evaluate(() => {
        const targetWindow = window as typeof window & {
          __codePilotXInputPaint?: Promise<number>
        }
        return targetWindow.__codePilotXInputPaint
      }),
    )
  }
  return nearestRankP95(latencies)
}

async function measureSidebarDrop(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
): Promise<{ dropReadyMs: number; moveMs: number }> {
  await target.evaluate(element => {
    const targetWindow = window as typeof window & {
      __codePilotXDropReady?: Promise<{
        dropReadyMs: number
        moveMs: number
      }>
    }
    targetWindow.__codePilotXDropReady = new Promise(resolve => {
      let dropReadyMs: number | null = null
      let moveMs: number | null = null
      const finish = (): void => {
        if (dropReadyMs === null || moveMs === null) return
        resolve({ dropReadyMs, moveMs })
      }
      element.addEventListener(
        'dragover',
        () => {
          const movedAt = performance.now()
          requestAnimationFrame(() => {
            moveMs = performance.now() - movedAt
            finish()
          })
        },
        { capture: true, once: true },
      )
      element.addEventListener(
        'drop',
        () => {
          const droppedAt = performance.now()
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              dropReadyMs = performance.now() - droppedAt
              finish()
            }),
          )
        },
        { capture: true, once: true },
      )
    })
  })
  await source.dragTo(target)
  return page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __codePilotXDropReady?: Promise<{
        dropReadyMs: number
        moveMs: number
      }>
    }
    return targetWindow.__codePilotXDropReady
  })
}

async function performSidebarDrag(
  page: import('@playwright/test').Page,
  handle: import('@playwright/test').Locator,
  steps: number,
  release: boolean,
): Promise<void> {
  const box = await handle.boundingBox()
  if (!box) throw new Error('Sidebar resize handle has no bounds')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      box.x + box.width / 2 + step * (90 / steps),
      box.y + box.height / 2,
    )
  }
  if (release) await page.mouse.up()
}

async function scrollTimeline(
  scrollArea: import('@playwright/test').Locator,
): Promise<void> {
  await scrollArea.evaluate(async element => {
    for (let step = 0; step < 100; step += 1) {
      element.scrollTop =
        (step / 99) * Math.max(0, element.scrollHeight - element.clientHeight)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
  })
}

async function settlePage(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        const finish = (): void => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(finish, { timeout: 1_000 })
        } else {
          finish()
        }
      }),
  )
}

async function collectHeapAfterGc(
  page: import('@playwright/test').Page,
): Promise<number> {
  return page.evaluate(async () => {
    const target = globalThis as typeof globalThis & { gc?: () => void }
    target.gc?.()
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    return (
      performance as Performance & {
        memory?: { usedJSHeapSize: number }
      }
    ).memory?.usedJSHeapSize ?? 0
  })
}
