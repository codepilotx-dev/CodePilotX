import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  DEFAULT_APPEARANCE_SETTINGS,
} from "../src/settings/appearance-settings-store.js"
import { readStartupAppearanceConfig } from "../src/settings/startup-appearance-config.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })))
})

describe("startup appearance config", () => {
  test("优先读取 config.toml 的 desktop.appearance", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-startup-theme-"))
    roots.push(root)
    const configPath = join(root, "config.toml")
    const legacyPath = join(root, "appearance-settings.json")
    await writeFile(configPath, [
      "[desktop.appearance]",
      "version = 6",
      'mode = "dark"',
      'iconTheme = "system"',
      'codeTheme = "system"',
      'chromeTheme = "default"',
      "pointerCursorEnabled = true",
      "fontSmoothingEnabled = true",
      "",
    ].join("\n"), "utf8")
    await writeFile(
      legacyPath,
      JSON.stringify({ ...DEFAULT_APPEARANCE_SETTINGS, mode: "light" }),
      "utf8",
    )
    expect(await readStartupAppearanceConfig(configPath, legacyPath)).toMatchObject({
      version: 6,
      mode: "dark",
    })
  })

  test("无效或缺失 TOML 只读回退旧文件，不创建新旧设置文件", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-startup-theme-"))
    roots.push(root)
    const configPath = join(root, "config.toml")
    const legacyPath = join(root, "appearance-settings.json")
    await writeFile(configPath, "desktop = [", "utf8")
    await writeFile(
      legacyPath,
      JSON.stringify({ ...DEFAULT_APPEARANCE_SETTINGS, mode: "light" }),
      "utf8",
    )
    expect(await readStartupAppearanceConfig(configPath, legacyPath)).toMatchObject({
      mode: "light",
    })
  })
})
