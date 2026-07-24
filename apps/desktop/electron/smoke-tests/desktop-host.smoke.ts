import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test"
import type { DesktopThemeSettingsV6 } from "@codepilotx/shared/desktop-theme"
import type { DesktopPetPresentation } from "@codepilotx/shared/desktop-pet-overlay"
import type { DesktopSettingsPayload } from "@codepilotx/shared/desktop-settings-ipc"
import type { DesktopDataLocationState } from "@codepilotx/shared/desktop-data-location-ipc"

declare global {
  interface Window {
    codePilotXDesktop: {
      getAppearanceSettings(): Promise<DesktopThemeSettingsV6>
      saveAppearanceSettings(settings: DesktopThemeSettingsV6): Promise<void>
      getDataLocation(): Promise<DesktopDataLocationState>
      openPetOverlay(): Promise<void>
      hidePetOverlay(): Promise<void>
      getPetOverlayWindowState(): Promise<{
        open: boolean
        bounds: { x: number; y: number; width: number; height: number }
      }>
      beginPetDrag(): void
      updatePetDrag(): void
      endPetDrag(): void
      setPetPointerPassthrough(passthrough: boolean): void
      previewPetPresentation(
        presentation: DesktopPetPresentation,
      ): Promise<DesktopPetPresentation>
      onPetPresentationPreview(
        listener: (presentation: DesktopPetPresentation) => void,
      ): () => void
      getPetGlobalPointerPosition(): Promise<{ x: number; y: number }>
      getDesktopSettings(): Promise<DesktopSettingsPayload>
      saveDesktopSettings(
        settings: DesktopSettingsPayload,
      ): Promise<DesktopSettingsPayload>
      onDesktopSettingsChange(
        listener: (settings: DesktopSettingsPayload) => void,
      ): () => void
    }
  }
}

const repositoryRoot = resolve(import.meta.dirname, "../../../..")
const electronRoot = resolve(repositoryRoot, "apps/desktop/electron")
const rendererDist = resolve(repositoryRoot, "dist/renderer")
const modelSnapshot = resolve(repositoryRoot, "resources/models.snapshot.json")

test.describe("真实 Electron 宿主", () => {
  let userDataDirectory = ""
  let logDirectory = ""
  let application: ElectronApplication | undefined

  test.beforeEach(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), "codepilotx-electron-smoke-"))
    logDirectory = join(userDataDirectory, "logs")
  })

  test.afterEach(async () => {
    await application?.close().catch(() => undefined)
    await rm(userDataDirectory, { force: true, recursive: true })
  })

  test("使用 preload 应用并持久化 V6 主题，且新路由均可达", async () => {
    application = await launchDesktop(userDataDirectory, logDirectory)
    let page = await application.firstWindow()
    await waitForApplication(page)
    await expect
      .poll(() =>
        existsSync(join(userDataDirectory, "agent-home", "history.sqlite")),
      )
      .toBe(true)
    expect(
      existsSync(join(userDataDirectory, "agent", "history.sqlite")),
    ).toBe(false)

    await expectHostContract(page)
    const settings = await page.evaluate(async () =>
      window.codePilotXDesktop.getAppearanceSettings(),
    )
    expect(settings.version).toBe(6)
    expect(await page.evaluate(() =>
      window.codePilotXDesktop.getDataLocation(),
    )).toMatchObject({
      currentDataDir: join(userDataDirectory, "agent-home"),
      controlSource: "env",
      isEnvControlled: true,
    })

    await page.evaluate(() => window.codePilotXDesktop.openPetOverlay())
    await expect
      .poll(() =>
        application
          ?.windows()
          .find(candidate => candidate.url().endsWith("/#/pet-overlay"))
          ?.url() ?? null,
      )
      .toMatch(/\/#\/pet-overlay$/)
    const overlayPage = application
      .windows()
      .find(candidate => candidate.url().endsWith("/#/pet-overlay"))
    if (!overlayPage) throw new Error("Electron smoke 未找到宠物悬浮窗")
    await expect(overlayPage.locator(".pet-overlay-page")).toBeAttached()
    expect(
      await overlayPage.evaluate(() => ({
        hasDesktopBridge: typeof window.codePilotXDesktop === "object",
        hasDragBridge:
          typeof window.codePilotXDesktop.beginPetDrag === "function",
        hasPointerBridge:
          typeof window.codePilotXDesktop.setPetPointerPassthrough ===
          "function",
        hasPresentationBridge:
          typeof window.codePilotXDesktop.onPetPresentationPreview ===
          "function",
        hasGlobalPointerBridge:
          typeof window.codePilotXDesktop.getPetGlobalPointerPosition ===
          "function",
      })),
    ).toEqual({
      hasDesktopBridge: true,
      hasDragBridge: true,
      hasGlobalPointerBridge: true,
      hasPointerBridge: true,
      hasPresentationBridge: true,
    })
    const presentationPreview = overlayPage.evaluate(
      () =>
        new Promise<DesktopPetPresentation>(resolve => {
          const unsubscribe =
            window.codePilotXDesktop.onPetPresentationPreview(value => {
              unsubscribe()
              resolve(value)
            })
        }),
    )
    expect(
      await page.evaluate(() =>
        window.codePilotXDesktop.previewPetPresentation({
          selectedPetId: "smoke-pet",
          size: 500,
        }),
      ),
    ).toEqual({ selectedPetId: "smoke-pet", size: 224 })
    await expect(presentationPreview)
      .resolves.toEqual({ selectedPetId: "smoke-pet", size: 224 })
    expect(
      await overlayPage.evaluate(() =>
        window.codePilotXDesktop.getPetGlobalPointerPosition(),
      ),
    ).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
    })
    await expect(
      page.evaluate(() =>
        window.codePilotXDesktop.getPetGlobalPointerPosition(),
      ),
    ).rejects.toThrow("IPC 调用来源无效")
    const settingsChanged = page.evaluate(
      () =>
        new Promise<DesktopSettingsPayload>(resolve => {
          const unsubscribe =
            window.codePilotXDesktop.onDesktopSettingsChange(value => {
              unsubscribe()
              resolve(value)
            })
        }),
    )
    const overlaySettingsChanged = overlayPage.evaluate(
      () =>
        new Promise<DesktopSettingsPayload>(resolve => {
          const unsubscribe =
            window.codePilotXDesktop.onDesktopSettingsChange(value => {
              unsubscribe()
              resolve(value)
            })
        }),
    )
    const currentDesktopSettings = await page.evaluate(() =>
      window.codePilotXDesktop.getDesktopSettings(),
    )
    await expect(
      overlayPage.evaluate(value =>
        window.codePilotXDesktop.saveDesktopSettings(value), currentDesktopSettings),
    ).rejects.toThrow("IPC 调用来源无效")
    await page.evaluate(
      value => window.codePilotXDesktop.saveDesktopSettings(value),
      currentDesktopSettings,
    )
    await expect(settingsChanged).resolves.toEqual(currentDesktopSettings)
    await expect(overlaySettingsChanged)
      .resolves.toEqual(currentDesktopSettings)
    await overlayPage.evaluate(() => {
      window.codePilotXDesktop.setPetPointerPassthrough(false)
      window.codePilotXDesktop.beginPetDrag()
      window.codePilotXDesktop.updatePetDrag()
      window.codePilotXDesktop.endPetDrag()
      window.codePilotXDesktop.setPetPointerPassthrough(true)
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.codePilotXDesktop.getPetOverlayWindowState(),
        ),
      )
      .toMatchObject({ open: true })
    await page.evaluate(() => window.codePilotXDesktop.hidePetOverlay())
    await page.evaluate(() =>
      window.codePilotXDesktop.previewPetPresentation({
        selectedPetId: null,
        size: 112,
      }),
    )
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.codePilotXDesktop.getPetOverlayWindowState(),
        ),
      )
      .toMatchObject({ open: false })
    await page.evaluate(() => window.codePilotXDesktop.openPetOverlay())
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.codePilotXDesktop.getPetOverlayWindowState(),
        ),
      )
      .toMatchObject({ open: true })

    await page.evaluate(async current => {
      await window.codePilotXDesktop.saveAppearanceSettings({
        ...current,
        mode: "dark",
        pointerCursorEnabled: true,
        reduceMotion: "on",
        fontSmoothingEnabled: false,
        fontSizes: { ui: 16, code: 24 },
        chromeThemes: {
          light: { ...current.chromeThemes.light },
          dark: {
            ...current.chromeThemes.dark,
            surface: "#121725",
            ink: "#f4f6ff",
            accent: "#8db8ff",
          },
        },
      })
    }, settings)

    await page.reload()
    await waitForApplication(page)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await expect(page.locator("html")).toHaveAttribute(
      "data-pointer-cursor",
      "on",
    )
    await expect(page.locator("html")).toHaveAttribute(
      "data-reduce-motion",
      "on",
    )
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--font-size-ui")
            .trim(),
        ),
      )
      .toBe("16px")

    for (const route of [
      "/new",
      "/settings/general",
      "/labs",
      "/not-a-real-route",
    ]) {
      await page.evaluate(nextRoute => {
        location.hash = `#${nextRoute}`
      }, route)
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${route}`)
    }
    await expect(
      page.getByRole("heading", { name: "这个页面不存在" }),
    ).toBeVisible()

    const restoredBounds = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        candidate =>
          !candidate.webContents.getURL().endsWith("/#/pet-overlay"),
      )
      if (!window) throw new Error("Electron smoke 未找到主窗口")
      const current = window.getBounds()
      const next = {
        x: current.x + 20,
        y: current.y + 20,
        width: 1180,
        height: 760,
      }
      window.unmaximize()
      window.setBounds(next)
      await new Promise(resolve => setTimeout(resolve, 350))
      const normalBounds = window.getBounds()
      window.maximize()
      return normalBounds
    })
    await expect.poll(() =>
      application?.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find(
          candidate =>
            !candidate.webContents.getURL().endsWith("/#/pet-overlay"),
        )?.isMaximized() ?? false,
      ),
    ).toBe(true)

    await application.close()
    application = undefined
    application = await launchDesktop(userDataDirectory, logDirectory)
    page = await application.firstWindow()
    await waitForApplication(page)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    const persisted = await page.evaluate(async () =>
      window.codePilotXDesktop.getAppearanceSettings(),
    )
    expect(persisted).toMatchObject({
      version: 6,
      mode: "dark",
      pointerCursorEnabled: true,
      reduceMotion: "on",
      fontSmoothingEnabled: false,
      fontSizes: { ui: 16, code: 24 },
    })
    expect(persisted.chromeThemes.dark).toMatchObject({
      surface: "#121725",
      ink: "#f4f6ff",
      accent: "#8db8ff",
    })
    await expect.poll(() =>
      application?.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(
          candidate =>
            !candidate.webContents.getURL().endsWith("/#/pet-overlay"),
        )
        return window
          ? {
              backgroundColor: window.getBackgroundColor().toLowerCase(),
              maximized: window.isMaximized(),
              normalBounds: window.getNormalBounds(),
            }
          : null
      }),
    ).toMatchObject({
      backgroundColor: "#121725",
      maximized: true,
    })
    const restoredWindowState = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        candidate =>
          !candidate.webContents.getURL().endsWith("/#/pet-overlay"),
      )
      if (!window) throw new Error("Electron smoke 未找到重启后的主窗口")
      return window.getNormalBounds()
    })
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(restoredWindowState[key] - restoredBounds[key]),
        `重启后的 ${key} 应接近保存值`,
      ).toBeLessThanOrEqual(10)
    }

    await application.close()
    application = undefined
  })
})

async function launchDesktop(
  userDataDirectory: string,
  logDirectory: string,
): Promise<ElectronApplication> {
  const packagedExecutable =
    process.env.CODEPILOTX_SMOKE_EXECUTABLE?.trim()
  return electron.launch({
    ...(packagedExecutable
      ? { executablePath: resolve(packagedExecutable), args: [] }
      : { args: [electronRoot] }),
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CODEPILOTX_BUN_PATH: resolveBunExecutable(),
      CODEPILOTX_USER_DATA_DIR: userDataDirectory,
      CODEPILOTX_DATA_DIR: join(userDataDirectory, "agent-home"),
      CODEPILOTX_LOG_DIR: logDirectory,
      CODEPILOTX_STATIC_DIR: rendererDist,
      CODEPILOTX_MODEL_SNAPSHOT: modelSnapshot,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  })
}

async function waitForApplication(page: Page): Promise<void> {
  await page.waitForURL(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, {
    timeout: 60_000,
  })
  await expect(page.locator("html")).toHaveAttribute(
    "data-window-type",
    "electron",
  )
}

async function expectHostContract(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute(
    "data-window-type",
    "electron",
  )
  await expect(page.locator("html")).toHaveAttribute("data-os", "windows")
  expect(
    await page.evaluate(() => ({
      hasDesktopBridge: typeof window.codePilotXDesktop === "object",
      hasNodeRequire: typeof (window as unknown as { require?: unknown }).require,
      tokenCount: (() => {
        const names = new Set<string>()
        const visit = (rules: CSSRuleList): void => {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
              for (const name of Array.from(rule.style)) {
                if (name.startsWith("--color-token-")) names.add(name)
              }
            }
            if ("cssRules" in rule) {
              visit((rule as CSSGroupingRule).cssRules)
            }
          }
        }
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            visit(sheet.cssRules)
          } catch {
            // Same-origin application styles are readable; vendor sheets may not be.
          }
        }
        const computed = getComputedStyle(document.documentElement)
        return Array.from(names).filter(
          name => computed.getPropertyValue(name).trim().length > 0,
        ).length
      })(),
    })),
  ).toEqual({
    hasDesktopBridge: true,
    hasNodeRequire: "undefined",
    tokenCount: 117,
  })
}

function resolveBunExecutable(): string {
  if (process.env.CODEPILOTX_BUN_PATH) {
    return process.env.CODEPILOTX_BUN_PATH
  }
  const output = execFileSync("where.exe", ["bun"], {
    encoding: "utf8",
    windowsHide: true,
  })
  const commandPaths = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const executable = [
    ...commandPaths.filter(path => path.toLowerCase().endsWith(".exe")),
    ...commandPaths.map(path =>
      join(dirname(path), "node_modules/bun/bin/bun.exe"),
    ),
  ].find(path => existsSync(path))
  if (!executable) throw new Error("Electron smoke 测试未找到 bun.exe")
  return executable
}
