import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  AppearanceSettingsStore,
  DEFAULT_APPEARANCE_SETTINGS,
  NewerAppearanceSettingsVersionError,
  migrateAppearanceSettings,
  normalizeAppearanceSettings,
} from "../src/settings/appearance-settings-store"

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
  test("首次读取创建当前代际的设置文件", async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)

    expect(await store.load()).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  test("损坏 JSON 备份旧文件、记录无敏感信息的事件并恢复默认值", async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, "{not-json", "utf8")

    expect(await store.load()).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    const corruptFiles = (await readdir(root)).filter(
      name => name.startsWith("appearance-settings.corrupt-") && name.endsWith(".json"),
    )
    expect(corruptFiles).toHaveLength(1)
    expect(await readFile(join(root, corruptFiles[0]!), "utf8")).toBe("{not-json")
    expect(records).toEqual([{
      event: "appearance-settings.corrupt-backed-up",
      fields: { reason: "invalid-json" },
    }])
    expect(JSON.stringify(records)).not.toContain(root)
    expect(JSON.stringify(records)).not.toContain("not-json")
  })

  test("保存当前代际时规范化字段并限制数值和颜色", () => {
    const normalized = normalizeAppearanceSettings({
      version: 6,
      mode: "dark",
      codeThemeIds: { light: "auto", dark: "linear-dark" },
      pointerCursorEnabled: true,
      reduceMotion: "on",
      fontSizes: { ui: 999, code: 1 },
    })

    expect(normalized).toMatchObject({
      version: 6,
      mode: "dark",
      codeThemeIds: { light: "codex-light", dark: "linear-dark" },
      pointerCursorEnabled: true,
      reduceMotion: "on",
      fontSizes: { ui: 16, code: 8 },
    })
    expect(normalized.chromeThemes.light).not.toHaveProperty("opaqueWindows")
    expect(normalized.chromeThemes.dark).not.toHaveProperty("opaqueWindows")
  })

  test("读取旧设置时直接覆盖为 V6 默认值", async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, JSON.stringify({
      version: 2,
      mode: "light",
      codeThemeIds: { light: "auto", dark: "codex-dark" },
      chromeThemes: {
        light: {
          accent: "#ABCDEF",
          fonts: { ui: "  Inter  ", code: "JetBrains Mono" },
        },
      },
      reduceMotion: "on",
      fontSizes: { ui: 13, code: 11 },
    }), "utf8")

    const loaded = await store.load()

    expect(loaded).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(loaded)
    expect(records).toEqual([])
  })

  test("所有已知旧版本都重置为 V6 默认值", () => {
    for (const version of [1, 2, 3, 4, 5]) {
      expect(migrateAppearanceSettings({
        version,
        mode: "dark",
        pointerCursorEnabled: true,
      })).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    }
  })

  test("读取更新版本时保留原文件并拒绝覆盖", async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    const futureSettings = JSON.stringify({
      version: 7,
      mode: "light",
      futureField: "must-survive",
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, futureSettings, "utf8")

    await expect(store.load()).rejects.toBeInstanceOf(NewerAppearanceSettingsVersionError)
    expect(await readFile(store.filePath, "utf8")).toBe(futureSettings)
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
