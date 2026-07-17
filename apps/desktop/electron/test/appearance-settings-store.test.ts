import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  AppearanceSettingsStore,
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
} from "../src/appearance-settings-store"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function temporaryRoot(): string {
  const root = join(import.meta.dir, `.appearance-${crypto.randomUUID()}`)
  roots.push(root)
  return root
}

describe("Electron 外观设置存储", () => {
  test("首次读取创建规范化的 V3 设置文件", async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)

    expect(await store.load()).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  test("损坏 JSON 回退默认值并修复设置文件", async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, "{not-json", "utf8")

    expect(await store.load()).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  test("迁移 V2 字段并限制数值和颜色", () => {
    const migrated = normalizeAppearanceSettings({
      version: 2,
      mode: "dark",
      codeThemeIds: { light: "auto", dark: "linear-dark" },
      glassmorphismEnabled: false,
      pointerCursorEnabled: true,
      reduceMotion: "on",
      fontSizes: { ui: 999, code: 1 },
    })

    expect(migrated).toMatchObject({
      version: 3,
      mode: "dark",
      codeThemeIds: { light: "codex-light", dark: "linear-dark" },
      pointerCursorEnabled: true,
      reduceMotion: "on",
      fontSizes: { ui: 16, code: 8 },
    })
    expect(migrated.chromeThemes.light.opaqueWindows).toBe(true)
    expect(migrated.chromeThemes.dark.opaqueWindows).toBe(true)
  })

  test("读取旧版本时持久化迁移结果", async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, JSON.stringify({
      version: 2,
      mode: "light",
      codeThemeIds: { light: "auto", dark: "codex-dark" },
      glassmorphismEnabled: true,
      fontSizes: { ui: 13, code: 11 },
    }), "utf8")

    const loaded = await store.load()

    expect(loaded.version).toBe(3)
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(loaded)
  })

  test("并发保存按调用顺序串行，文件始终是完整 JSON", async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    const first = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      mode: "light",
    })
    const second = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      mode: "dark",
    })

    await Promise.all([store.save(first), store.save(second)])

    const restartedStore = new AppearanceSettingsStore(root)
    expect(await restartedStore.load()).toEqual(second)
  })
})
