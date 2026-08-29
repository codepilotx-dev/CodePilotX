import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  closeTransientErrorToast,
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

const MOTION_MODES = ['on', 'off'] as const

test.describe('animation contracts', () => {
  for (const motion of MOTION_MODES) {
    test(`editor file tree toggle commits width and unmounts presence (${motion})`, async ({
      page,
    }) => {
      await openVisualFixture(page, 'rich', motion)
      await page.getByRole('button', { name: '显示右侧面板' }).click()
      const rightPanel = page.getByRole('complementary', {
        name: '右侧面板',
      })
      await rightPanel.getByRole('button', { name: '文件 Ctrl+P' }).click()
      await rightPanel.getByText('README.md', { exact: true }).click()
      const preview = rightPanel.locator('.right-dock-file-preview')
      const showTree = preview.getByRole('button', {
        name: '显示文件树',
      })
      await expect(showTree).toBeVisible()
      await expect(showTree).toHaveAttribute('aria-pressed', 'false')

      // 显示：一次提交最终 flex 宽度，编辑器与文件树并排。
      await showTree.click()
      const presence = rightPanel.locator(
        '.right-dock-editor-file-tree-presence',
      )
      await expect(presence).toHaveAttribute('data-presence', 'present')
      const tree = rightPanel.locator('.right-dock-editor-file-tree')
      const editor = rightPanel.locator('.right-dock-file-selection-target')
      await expect
        .poll(async () => {
          const editorBox = await editor.boundingBox()
          const treeBox = await tree.boundingBox()
          return editorBox && treeBox
            ? Math.abs(editorBox.x + editorBox.width - treeBox.x)
            : -1
        })
        .toBeLessThanOrEqual(1)
      const treeBox = await tree.boundingBox()
      expect(treeBox?.width).toBeCloseTo(288, 0)
      const hideTree = preview.getByRole('button', {
        name: '隐藏文件树',
      })
      await expect(hideTree).toHaveAttribute('aria-pressed', 'true')

      // 隐藏：退出后 DOM 卸载、编辑器回到整宽、焦点回到 toggle。
      await hideTree.click()
      await expect(preview.locator('.right-dock-editor-file-tree-presence')).toHaveCount(0)
      await expect(showTree).toBeFocused()
      const layout = preview.locator('.right-dock-file-editor-layout')
      await expect
        .poll(async () => {
          const editorBox = await editor.boundingBox()
          const layoutBox = await layout.boundingBox()
          return editorBox && layoutBox
            ? Math.abs(editorBox.x + editorBox.width - (layoutBox.x + layoutBox.width))
            : -1
        })
        .toBeLessThanOrEqual(1)

      // 重新显示：宽度与并排布局恢复。
      await showTree.click()
      await expect(presence).toHaveAttribute('data-presence', 'present')
      const restoredTreeBox = await tree.boundingBox()
      expect(restoredTreeBox?.width).toBeCloseTo(288, 0)
    })

    test(`sidebar section and extra session items collapse keep final layout (${motion})`, async ({
      page,
    }) => {
      await openVisualFixture(page, 'scroll-edge', motion)
      const recentToggle = page.locator(
        '[data-sidebar-section-id="recent"]',
      )
      await expect(recentToggle).toBeVisible()
      await expect(recentToggle).toHaveAttribute('aria-expanded', 'true')
      const recentSection = page
        .locator('.sidebar-section')
        .filter({ has: recentToggle })

      // 会话扩展：展开/折叠额外排序项。
      const showMore = page.getByRole('button', { name: '展开显示' })
      await expect(showMore).toBeVisible()
      await showMore.click()
      const extraItems = page.locator('[data-sidebar-session-extra="true"]')
      await expect(extraItems.first()).toBeVisible()
      await page.getByRole('button', { name: '折叠显示' }).click()
      await expect(extraItems).toHaveCount(0)

      // section 折叠：内容卸载、ARIA 同步、键盘可恢复。
      await recentToggle.click()
      await expect(recentToggle).toHaveAttribute('aria-expanded', 'false')
      await expect(
        recentSection.locator('.sidebar-section-content'),
      ).toHaveCount(0)
      await recentToggle.focus()
      await page.keyboard.press('Enter')
      await expect(recentToggle).toHaveAttribute('aria-expanded', 'true')
      await expect(
        recentSection.locator('.sidebar-section-content'),
      ).toBeVisible()
    })

    test(`process group and turn activity collapse with edge fades (${motion})`, async ({
      page,
    }) => {
      await openVisualFixture(page, 'scroll-edge', motion)
      const turnActivitySummary = page.locator(
        '.canonical-turn-activity__summary',
      )
      await expect(turnActivitySummary).toBeVisible()
      if (await turnActivitySummary.getAttribute('aria-expanded') === 'false') {
        await turnActivitySummary.click()
      }
      const processSummary = page.locator(
        '.canonical-process-group__summary',
      )
      await expect(processSummary).toBeVisible()

      // 展开 process group：items 可滚动，顶部/底部渐隐状态正确。
      await processSummary.click()
      await expect(processSummary).toHaveAttribute('aria-expanded', 'true')
      const edgeFrame = page.locator('.canonical-process-edge-fade')
      await expect(edgeFrame).toHaveAttribute('data-scrollable', 'true')
      await expect(edgeFrame).toHaveAttribute('data-at-start', 'true')
      await expect(edgeFrame).toHaveAttribute('data-at-end', 'false')

      const items = page.locator('.canonical-process-group__items')
      await scrollNested(items, 0.5)
      await expect(edgeFrame).toHaveAttribute('data-at-start', 'false')
      await expect(edgeFrame).toHaveAttribute('data-at-end', 'false')
      await scrollNested(items, 1)
      await expect(edgeFrame).toHaveAttribute('data-at-start', 'false')
      await expect(edgeFrame).toHaveAttribute('data-at-end', 'true')

      // 内容尺寸增长会由 content ResizeObserver 主动重测，无需用户滚动。
      const firstCard = items.locator('.canonical-process-card').first()
      const collapsedHeight = await items.evaluate(element => element.scrollHeight)
      await firstCard.evaluate((element: HTMLDetailsElement) => {
        element.open = true
      })
      await expect(firstCard).toHaveJSProperty('open', true)
      await expect
        .poll(() => items.evaluate(element => element.scrollHeight))
        .toBeGreaterThan(collapsedHeight)
      await expect(edgeFrame).toHaveAttribute('data-at-end', 'false')

      // command shell 的伪元素留在外 frame，只有内层 scroller 移动。
      const commandFrame = firstCard
        .locator('.canonical-command-shell__edge-fade')
        .first()
      const commandScroller = commandFrame.locator(
        '.canonical-command-shell__scroller',
      )
      await commandFrame
        .locator('.canonical-command-shell__scroll-content')
        .evaluate(element => {
          const overflow = document.createElement('div')
          overflow.dataset.visualOverflow = 'true'
          overflow.style.height = '240px'
          element.appendChild(overflow)
        })
      await expect(commandFrame).toHaveAttribute('data-scrollable', 'true')
      const frameBeforeScroll = await commandFrame.boundingBox()
      await scrollNested(commandScroller, 1)
      const frameAfterScroll = await commandFrame.boundingBox()
      expect(frameAfterScroll?.y).toBeCloseTo(frameBeforeScroll?.y ?? 0, 0)
      expect(frameAfterScroll?.height).toBeCloseTo(
        frameBeforeScroll?.height ?? 0,
        0,
      )

      await firstCard.evaluate((element: HTMLDetailsElement) => {
        element.open = false
      })
      await scrollNested(items, 0)
      await expect(edgeFrame).toHaveAttribute('data-at-start', 'true')

      // 折叠 process group：内容卸载，ARIA 同步。
      await processSummary.click()
      await expect(processSummary).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('.canonical-process-edge-fade')).toHaveCount(0)

      // turn activity 折叠：内容卸载，结果区仍在布局流中。
      const activitySummary = page.locator(
        '.canonical-turn-activity__summary',
      )
      await expect(activitySummary).toBeVisible()
      await activitySummary.click()
      await expect(activitySummary).toHaveAttribute('aria-expanded', 'false')
      await expect(
        page.locator('.canonical-turn-activity__content'),
      ).toHaveCount(0)
      await expect(page.locator('.canonical-turn__result')).toBeVisible()
    })

    test(`execution plan steps edge fades follow scroll (${motion})`, async ({
      page,
    }) => {
      await openVisualFixture(page, 'scroll-edge', motion)
      const planButton = page.locator('.composer-change-summary__plan')
      await expect(planButton).toBeVisible()
      await planButton.click()
      const stepsFrame = page.locator('.execution-plan-card__edge-fade')
      await expect(stepsFrame).toHaveAttribute('data-scrollable', 'true')
      await expect(stepsFrame).toHaveAttribute('data-at-start', 'true')
      const steps = page.locator('.execution-plan-card__steps-scroller')
      await scrollNested(steps, 1)
      await expect(stepsFrame).toHaveAttribute('data-at-start', 'false')
      await expect(stepsFrame).toHaveAttribute('data-at-end', 'true')
      await scrollNested(steps, 0)
      await expect(stepsFrame).toHaveAttribute('data-at-end', 'false')
    })

    test(`execution plan preview enters at its final width (${motion})`, async ({
      page,
    }) => {
      await openVisualFixture(page, 'execution-plan', motion)
      const capsule = page.locator('.composer-change-summary__bar')
      const planButton = page.locator('.composer-change-summary__plan')
      const preview = page.locator('.composer-change-summary__plan-preview')
      const planCard = preview.locator('.execution-plan-card')
      const capsuleBefore = await capsule.boundingBox()
      expect(capsuleBefore).not.toBeNull()

      await page.evaluate(() => {
        type PlanPreviewSample = {
          animationName: string
          transform: string
          width: number
        }
        const runtimeWindow = window as typeof window & {
          __planPreviewSamples?: PlanPreviewSample[]
        }
        runtimeWindow.__planPreviewSamples = []
        const host = document.querySelector('.composer-change-summary')
        if (!host) throw new Error('缺少 Composer 变更摘要容器')

        const observer = new MutationObserver(() => {
          const previewElement = host.querySelector<HTMLElement>(
            '.composer-change-summary__plan-preview',
          )
          const card = previewElement?.querySelector<HTMLElement>(
            '.execution-plan-card',
          )
          if (!previewElement || !card) return
          observer.disconnect()
          const deadline = performance.now() + 220
          const sample = (): void => {
            runtimeWindow.__planPreviewSamples?.push({
              animationName: getComputedStyle(card).animationName,
              transform: getComputedStyle(previewElement).transform,
              width: card.getBoundingClientRect().width,
            })
            if (performance.now() < deadline) requestAnimationFrame(sample)
          }
          sample()
        })
        observer.observe(host, { childList: true, subtree: true })
      })

      await planButton.focus()
      await expect(planCard).toBeVisible()
      await page.waitForTimeout(240)

      const samples = await page.evaluate(() => {
        const runtimeWindow = window as typeof window & {
          __planPreviewSamples?: Array<{
            animationName: string
            transform: string
            width: number
          }>
        }
        return runtimeWindow.__planPreviewSamples ?? []
      })
      expect(samples.length).toBeGreaterThan(0)
      expect(Math.min(...samples.map(sample => sample.width))).toBeGreaterThanOrEqual(480)
      expect(Math.max(...samples.map(sample => sample.width))).toBeLessThanOrEqual(760)
      expect(samples.every(sample => sample.transform === 'none')).toBe(true)
      expect(samples.every(sample => sample.animationName === 'none')).toBe(true)

      const capsuleAfter = await capsule.boundingBox()
      expect(capsuleAfter).not.toBeNull()
      expect(capsuleAfter!.width).toBeCloseTo(capsuleBefore!.width, 0)

      await planButton.evaluate(element => element.blur())
      await expect(preview).toHaveCount(0)
    })
  }

  test('skeleton shimmer and progress bars keep their compositor contract', async ({
    page,
  }) => {
    await openVisualFixture(page, 'scroll-edge', 'off')
    const styles = await page.evaluate(() => {
      const skeleton = document.createElement('div')
      skeleton.className = 'ui-skeleton-block'
      skeleton.style.cssText = 'width: 320px; height: 48px;'
      document.body.appendChild(skeleton)
      const skeletonAfter = getComputedStyle(skeleton, '::after')
      const skeletonBefore = getComputedStyle(skeleton)

      const composerTrack = document.createElement('div')
      composerTrack.className = 'composer-status-bar-track'
      composerTrack.innerHTML =
        '<div class="composer-status-bar-fill"></div>'
      composerTrack.style.cssText = 'width: 320px;'
      const composerFill = composerTrack.querySelector<HTMLElement>(
        '.composer-status-bar-fill',
      )!
      composerFill.style.setProperty('--usage-ratio', '0.6')
      document.body.appendChild(composerTrack)

      const composerStyle = getComputedStyle(composerFill)
      skeleton.remove()
      composerTrack.remove()
      return {
        composerOrigin: composerStyle.transformOrigin,
        composerTransform: composerStyle.transform,
        composerTransition: composerStyle.transitionProperty,
        skeletonAnimation: skeletonAfter.animationName,
        skeletonDuration: skeletonBefore.getPropertyValue('--motion-loading'),
        skeletonSweep: skeletonAfter.animationName === 'ui-skeleton-sweep',
      }
    })

    expect(styles.skeletonSweep).toBe(true)
    expect(styles.skeletonDuration).toBe('900ms')
    expect(styles.composerTransform).toBe('matrix(0.6, 0, 0, 1, 0, 0)')
    expect(styles.composerOrigin.startsWith('0%')).toBe(true)
    expect(styles.composerTransition).toBe('transform')
  })

  test('reduced motion renders a flat skeleton without shimmer', async ({ page }) => {
    await openVisualFixture(page, 'scroll-edge', 'on')
    const styles = await page.evaluate(() => {
      const skeleton = document.createElement('div')
      skeleton.className = 'ui-skeleton-block'
      skeleton.style.cssText = 'width: 320px; height: 48px;'
      document.body.appendChild(skeleton)
      const skeletonAfter = getComputedStyle(skeleton, '::after')
      const result = {
        animationName: skeletonAfter.animationName,
        backgroundImage: skeletonAfter.backgroundImage,
        content: skeletonAfter.content,
      }
      skeleton.remove()
      return result
    })

    expect(styles.animationName).toBe('none')
    expect(styles.backgroundImage).toBe('none')
    expect(styles.content).toBe('none')
  })
})

async function openVisualFixture(
  page: Page,
  visualCase: string,
  motion: (typeof MOTION_MODES)[number],
): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 768 })
  await prepareVisualTheme(page, 'light', { reduceMotion: motion })
  await page.goto(`/?visualCase=${visualCase}#/threads/visual-${visualCase}`)
  await waitForVisualPage(page, 'light')
  await closeTransientErrorToast(page)
}

async function scrollNested(
  scrollArea: import('@playwright/test').Locator,
  progress: number,
): Promise<void> {
  await scrollArea.evaluate((element, target) => {
    element.scrollTop =
      target * Math.max(0, element.scrollHeight - element.clientHeight)
  }, progress)
  await pageSettle(scrollArea.page())
}

async function pageSettle(page: Page): Promise<void> {
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
