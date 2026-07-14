import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { resolveBunExecutable } from "../src/sidecar-command"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("Bun sidecar 命令解析", () => {
  test("识别 npm/nvm Windows shim 后面的真实 bun.exe", () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    const executable = join(root, "node_modules", "bun", "bin", "bun.exe")
    roots.push(root)
    mkdirSync(join(root, "node_modules", "bun", "bin"), { recursive: true })
    writeFileSync(join(root, "bun.cmd"), "@echo off")
    writeFileSync(executable, "")

    expect(resolveBunExecutable({ Path: root }, "win32")).toBe(executable)
  })

  test("显式路径优先于 PATH 自动发现", () => {
    expect(resolveBunExecutable({ CODEPILOTX_BUN_PATH: "D:\\tools\\bun.exe", Path: "" }, "win32"))
      .toBe("D:\\tools\\bun.exe")
  })
})
