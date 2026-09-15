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

  test("损坏 JSON 删除旧文件、记录无敏感信息的事件并恢复默认值", async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, "{not-json", "utf8")

    expect(await store.load()).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(await readdir(root)).toEqual(["appearance-settings.json"])
    expect(records).toEqual([{
      event: "appearance-settings.corrupt-reset",
      fields: { reason: "invalid-json" },
    }])
    expect(JSON.stringify(records)).not.toContain(root)
    expect(JSON.stringify(records)).not.toContain("not-json")
  })

  test("保存当前代际时规范化字段并限制数值、颜色和字体 face", () => {
    const normalized = normalizeAppearanceSettings({
      version: 7,
      mode: "dark",
      codeThemeIds: { light: "auto", dark: "linear-dark" },
      pointerCursorEnabled: true,
      reduceMotion: "on",
      fontSizes: { ui: 999, code: 1 },
      chromeThemes: {
        light: {
          fonts: {
            ui: "Inter",
            uiFace: {
              family: "Inter",
              fullName: "Inter Regular",
              postscriptName: "Inter-Regular",
            },
            codeFace: {
              family: "JetBrains Mono",
              fullName: "JetBrains Mono Regular",
              postscriptName: "JetBrainsMono-Regular",
            },
          },
        },
      },
    })

    expect(normalized).toMatchObject({
      version: 7,
      mode: "dark",
      codeThemeIds: { light: "codex-light", dark: "linear-dark" },
      pointerCursorEnabled: true,
      reduceMotion: "on",
      fontSizes: { ui: 16, code: 8 },
    })
    expect(normalized.chromeThemes.light.fonts).toEqual({
      ui: "Inter",
      uiFace: {
        family: "Inter",
        fullName: "Inter Regular",
        postscriptName: "Inter-Regular",
      },
      code: null,
      codeFace: null,
    })
    expect(normalized.chromeThemes.light).not.toHaveProperty("opaqueWindows")
    expect(normalized.chromeThemes.dark).not.toHaveProperty("opaqueWindows")
  })

  test("非法、过长或不匹配的字体 face 回退为 null 并显式持久化", () => {
    const normalized = normalizeAppearanceSettings({
      version: 7,
      chromeThemes: {
        dark: {
          fonts: {
            ui: "Inter",
            uiFace: {
              family: "JetBrains Mono",
              fullName: "JetBrains Mono Bold",
              postscriptName: "JetBrainsMono-Bold",
            },
            code: "CodeMono",
            codeFace: {
              family: "A".repeat(201),
              fullName: "B",
              postscriptName: "C",
            },
          },
        },
      },
    })

    expect(normalized.chromeThemes.dark.fonts.uiFace).toBeNull()
    expect(normalized.chromeThemes.dark.fonts.codeFace).toBeNull()
    expect(normalized.chromeThemes.dark.fonts).toHaveProperty("uiFace", null)
    expect(normalized.chromeThemes.dark.fonts).toHaveProperty("codeFace", null)
    expect(normalized.chromeThemes.light.fonts).toEqual({
      ui: null,
      uiFace: null,
      code: null,
      codeFace: null,
    })
  })

  test("读取 V6 设置时保留式升级到 V7", async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    const v6 = {
      version: 6,
      mode: "light",
      codeThemeIds: { light: "github-light-default", dark: "codex-dark" },
      chromeThemes: {
        light: {
          accent: "#ABCDEF",
          surface: "#fefefe",
          ink: "#111111",
          contrast: 42,
          fonts: { ui: "  Inter  ", code: "JetBrains Mono" },
          semanticColors: {
            diffAdded: "#00a240",
            diffRemoved: "#ba2623",
            skill: "#924ff7",
          },
        },
        dark: {
          accent: "#339cff",
          surface: "#181818",
          ink: "#ffffff",
          contrast: 60,
          fonts: { ui: null, code: "Cascadia Code" },
          semanticColors: {
            diffAdded: "#40c977",
            diffRemoved: "#fa423e",
            skill: "#ad7bf9",
          },
        },
      },
      pointerCursorEnabled: true,
      reduceMotion: "off",
      fontSmoothingEnabled: false,
      fontSizes: { ui: 15, code: 13 },
    }
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, JSON.stringify(v6), "utf8")

    const loaded = await store.load()

    expect(loaded).toMatchObject({
      version: 7,
      mode: "light",
      codeThemeIds: { light: "github-light-default", dark: "codex-dark" },
      pointerCursorEnabled: true,
      reduceMotion: "off",
      fontSmoothingEnabled: false,
      fontSizes: { ui: 15, code: 13 },
    })
    expect(loaded.chromeThemes.light).toMatchObject({
      accent: "#abcdef",
      surface: "#fefefe",
      ink: "#111111",
      contrast: 42,
    })
    expect(loaded.chromeThemes.light.fonts).toEqual({
      ui: "Inter",
      uiFace: null,
      code: "JetBrains Mono",
      codeFace: null,
    })
    expect(loaded.chromeThemes.dark.fonts).toEqual({
      ui: null,
      uiFace: null,
      code: "Cascadia Code",
      codeFace: null,
    })
    const persisted = JSON.parse(await readFile(store.filePath, "utf8"))
    expect(persisted).toEqual(loaded)
    expect(records).toEqual([])
  })

  test("读取旧设置时直接覆盖为 V7 默认值", async () => {
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

  test("所有已知旧版本都重置为 V7 默认值", () => {
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
      version: 8,
      mode: "light",
      futureField: "must-survive",
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, futureSettings, "utf8")

    await expect(store.load()).rejects.toBeInstanceOf(NewerAppearanceSettingsVersionError)
    expect(await readFile(store.filePath, "utf8")).toBe(futureSettings)
  })

  test("未先 load 时也拒绝用当前版本覆盖更新版本文件", async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    const futureSettings = JSON.stringify({
      version: 8,
      mode: "light",
      futureField: "must-survive",
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, futureSettings, "utf8")

    await expect(store.save(DEFAULT_APPEARANCE_SETTINGS))
      .rejects.toBeInstanceOf(NewerAppearanceSettingsVersionError)
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
