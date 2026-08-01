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
  test("优先读取支持注释和尾逗号的 config.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-startup-theme-"))
    roots.push(root)
    const configPath = join(root, "config.json")
    const legacyConfigPath = join(root, "config.toml")
    const legacyPath = join(root, "appearance-settings.json")
    await writeFile(configPath, [
      "{",
      "  // JSONC 注释必须被接受",
      '  "desktop": {',
      '    "appearance": {',
      '      "version": 6,',
      '      "mode": "dark",',
      '      "iconTheme": "system",',
      '      "codeTheme": "system",',
      '      "chromeTheme": "default",',
      '      "pointerCursorEnabled": true,',
      '      "fontSmoothingEnabled": true,',
      "    },",
      "  },",
      "}",
    ].join("\n"), "utf8")
    await writeFile(legacyConfigPath, [
      "[desktop.appearance]",
      "version = 6",
      'mode = "light"',
    ].join("\n"), "utf8")
    await writeFile(
      legacyPath,
      JSON.stringify({ ...DEFAULT_APPEARANCE_SETTINGS, mode: "light" }),
      "utf8",
    )
    expect(await readStartupAppearanceConfig(
      configPath,
      legacyConfigPath,
      legacyPath,
    )).toMatchObject({
      version: 6,
      mode: "dark",
    })
  })

  test("config.json 不存在时回退读取 config.toml", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-startup-theme-"))
    roots.push(root)
    const configPath = join(root, "config.json")
    const legacyConfigPath = join(root, "config.toml")
    const legacyPath = join(root, "appearance-settings.json")
    await writeFile(legacyConfigPath, [
      "[desktop.appearance]",
      "version = 6",
      'mode = "dark"',
      'iconTheme = "system"',
      'codeTheme = "system"',
      'chromeTheme = "default"',
      "pointerCursorEnabled = true",
      "fontSmoothingEnabled = true",
    ].join("\n"), "utf8")
    await writeFile(
      legacyPath,
      JSON.stringify({ ...DEFAULT_APPEARANCE_SETTINGS, mode: "light" }),
      "utf8",
    )
    expect(await readStartupAppearanceConfig(
      configPath,
      legacyConfigPath,
      legacyPath,
    )).toMatchObject({
      mode: "dark",
    })
  })

  test("config.json 已存在但无效时不回退 config.toml", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-startup-theme-"))
    roots.push(root)
    const configPath = join(root, "config.json")
    const legacyConfigPath = join(root, "config.toml")
    const legacyPath = join(root, "appearance-settings.json")
    await writeFile(configPath, '{"desktop":', "utf8")
    await writeFile(legacyConfigPath, [
      "[desktop.appearance]",
      "version = 6",
      'mode = "dark"',
    ].join("\n"), "utf8")
    await writeFile(
      legacyPath,
      JSON.stringify({ ...DEFAULT_APPEARANCE_SETTINGS, mode: "light" }),
      "utf8",
    )
    expect(await readStartupAppearanceConfig(
      configPath,
      legacyConfigPath,
      legacyPath,
    )).toMatchObject({
      mode: "light",
    })
  })
})
