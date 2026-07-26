import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  STABLE_SCREENSHOT_OPTIONS,
  V6_VISUAL_BASELINES_ENABLED,
  VISUAL_MODES,
  expectNoHorizontalOverflow,
  prepareVisualTheme,
  waitForVisualPage,
  type VisualMode,
} from './visual-test-helpers.js'

const visualTest = V6_VISUAL_BASELINES_ENABLED ? test : test.skip

const SETTINGS_TABS = [
  { id: 'general', label: '常规' },
  { id: 'profile', label: '个人资料' },
  { id: 'appearance', label: '外观' },
  { id: 'pets', label: '宠物' },
  { id: 'config', label: '配置' },
  { id: 'personalization', label: '个性化' },
  { id: 'memory', label: '记忆' },
  { id: 'shortcuts', label: '键盘快捷键' },
  { id: 'billing', label: '使用情况和计费' },
  { id: 'plugins', label: '插件' },
  { id: 'browser', label: '浏览器' },
  { id: 'git', label: 'Git' },
  { id: 'archived', label: '已归档对话' },
] as const

type ButtonVisualContract = {
  height: string
  borderRadius: string
  paddingInline: string
  fontSize: string
  borderWidth: string
  borderStyle: string
  borderColor: string
  backgroundColor: string
  color: string
}

async function readButtonVisualContract(
  locator: Locator,
): Promise<ButtonVisualContract> {
  return locator.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      height: style.height,
      borderRadius: style.borderRadius,
      paddingInline: `${style.paddingLeft} ${style.paddingRight}`,
      fontSize: style.fontSize,
      borderWidth: `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`,
      borderStyle: `${style.borderTopStyle} ${style.borderRightStyle} ${style.borderBottomStyle} ${style.borderLeftStyle}`,
      borderColor: `${style.borderTopColor} ${style.borderRightColor} ${style.borderBottomColor} ${style.borderLeftColor}`,
      backgroundColor: style.backgroundColor,
      color: style.color,
    }
  })
}

async function resolveColorToken(
  page: Page,
  token: string,
): Promise<string> {
  return page.evaluate(customProperty => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = `var(${customProperty})`
    document.body.append(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  }, token)
}

async function resolveTextColorToken(
  page: Page,
  token: string,
): Promise<string> {
  return page.evaluate(customProperty => {
    const probe = document.createElement('span')
    probe.style.color = `var(${customProperty})`
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)
}

for (const mode of VISUAL_MODES) {
  for (const tab of SETTINGS_TABS) {
    visualTest(`settings ${tab.id} ${mode}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT)
      await prepareVisualTheme(page, mode)
      await page.goto(`/?visualCase=empty#/settings/${tab.id}`)
      const activeTab = page
        .locator('.settings-nav-item')
        .filter({ hasText: tab.label })
      await waitForVisualPage(page, mode, activeTab)
      await expect(activeTab).toHaveClass(/\bactive\b/)
      await expect(page.locator('.settings-content-scroll-area')).toBeVisible()
      await expect(page.locator('body')).toHaveScreenshot(
        `settings-${tab.id}-${mode}-1440x920.png`,
        {
          ...STABLE_SCREENSHOT_OPTIONS,
          fullPage: true,
        },
      )
      await expectNoHorizontalOverflow(page)
    })
  }
}

for (const mode of VISUAL_MODES) {
  visualTest(`action buttons use one visual contract ${mode}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, mode)

    const cases = [
      {
        route: '/?visualCase=empty#/settings/general',
        name: '导入',
      },
      {
        route: '/?visualCase=empty#/settings/pets',
        name: '打开宠物商店',
      },
      {
        route: '/?visualCase=empty#/models',
        name: '添加 API Key',
      },
    ] as const

    const contracts: ButtonVisualContract[] = []
    for (const item of cases) {
      await page.goto(item.route)
      const button = page.getByRole('button', { name: item.name, exact: true })
      await waitForVisualPage(page, mode, button)
      await expect(button).toBeVisible()
      contracts.push(await readButtonVisualContract(button))
    }

    expect(contracts[1]).toEqual(contracts[0])
    expect(contracts[2]).toEqual(contracts[0])

    const normalButton = page.getByRole('button', {
      name: '添加 API Key',
      exact: true,
    })
    const neutralBackground = await resolveColorToken(
      page,
      '--color-background-button-secondary',
    )
    const oldPrimaryBackground = await resolveColorToken(
      page,
      '--color-background-button-primary',
    )
    const foreground = await resolveTextColorToken(
      page,
      '--color-token-foreground',
    )
    expect(contracts[2]?.backgroundColor).toBe(neutralBackground)
    expect(contracts[2]?.color).toBe(foreground)
    if (mode === 'light') {
      expect(contracts[2]?.backgroundColor).not.toBe(oldPrimaryBackground)
    }

    const restingBackground = contracts[2]?.backgroundColor
    await normalButton.hover()
    await expect
      .poll(async () => (await readButtonVisualContract(normalButton)).backgroundColor)
      .not.toBe(restingBackground)
    expect((await readButtonVisualContract(normalButton)).color).toBe(foreground)

    await normalButton.focus()
    const focusOutline = await normalButton.evaluate(element => {
      const style = getComputedStyle(element)
      return `${style.outlineStyle} ${style.outlineWidth}`
    })
    expect(focusOutline).not.toBe('none 0px')
    expect((await readButtonVisualContract(normalButton)).color).toBe(foreground)

    await normalButton.evaluate(element => {
      element.setAttribute('data-selected', 'true')
    })
    expect((await readButtonVisualContract(normalButton)).color).toBe(foreground)

    await normalButton.evaluate(element => {
      element.removeAttribute('data-selected')
      element.setAttribute('data-tone', 'danger')
    })
    const dangerContract = await readButtonVisualContract(normalButton)
    expect(dangerContract.borderColor).not.toBe(contracts[2]?.borderColor)

    await normalButton.evaluate(element => {
      element.removeAttribute('data-tone')
      ;(element as HTMLButtonElement).disabled = true
    })
    const disabledOpacity = await normalButton.evaluate(element =>
      Number.parseFloat(getComputedStyle(element).opacity),
    )
    expect(disabledOpacity).toBeLessThan(1)
  })
}
for (const mode of VISUAL_MODES) {
  visualTest(`settings appearance ${mode} compact`, async ({ page }) => {
    await page.setViewportSize(COMPACT_VIEWPORT)
    await prepareVisualTheme(page, mode)
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      mode,
      page.getByRole('heading', { name: '外观' }),
    )
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-${mode}-960x640.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
    await expectNoHorizontalOverflow(page)
  })
}
const CONTRAST_BOUNDARIES = [0, 45, 60, 100] as const

for (const contrast of CONTRAST_BOUNDARIES) {
  visualTest(`appearance contrast ${contrast}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'dark', { contrast })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      'dark',
      page.getByRole('slider', { name: '深色对比度' }),
    )
    await expect(
      page.getByRole('slider', { name: '深色对比度' }),
    ).toHaveValue(String(contrast))
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-dark-contrast-${contrast}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}

for (const preset of [
  { id: 'font-min', uiFontSize: 11, codeFontSize: 8 },
  { id: 'font-max', uiFontSize: 16, codeFontSize: 24 },
] as const) {
  visualTest(`appearance ${preset.id}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'light', preset)
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      'light',
      page.getByRole('spinbutton', { name: '界面字号' }),
    )
    await expect(page.getByRole('spinbutton', { name: '界面字号' })).toHaveValue(
      String(preset.uiFontSize),
    )
    await expect(page.getByRole('spinbutton', { name: '代码字号' })).toHaveValue(
      String(preset.codeFontSize),
    )
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-light-${preset.id}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}

for (const reduceMotion of ['on', 'off'] as const) {
  visualTest(`appearance reduced motion ${reduceMotion}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'dark', { reduceMotion })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      'dark',
      page.getByRole('group', { name: '减少动态效果选项' }),
    )
    await expect(page.locator('html')).toHaveAttribute(
      'data-reduce-motion',
      reduceMotion,
    )
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-dark-motion-${reduceMotion}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}
