import { describe, expect, test } from "bun:test"
import {
  checkPluginApiCompatibility,
  compareVersions,
  parseRange,
  parseVersion,
  PLUGIN_API_VERSION,
  satisfiesVersion,
} from "../src/engine"

describe("SemVer 解析与比较", () => {
  test("解析严格版本与 prerelease/build", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null, build: null })
    expect(parseVersion("0.0.1")).not.toBeNull()
    expect(parseVersion("1.2.3-beta.1+build.5")?.prerelease).toEqual(["beta", 1])
    expect(parseVersion("1.2.3-beta.1+build.5")?.build).toBe("build.5")
    expect(parseVersion("v2.0.0")?.major).toBe(2)
  })

  test("拒绝非法版本", () => {
    for (const bad of ["1.2", "1", "a.b.c", "1.2.3.4", "1..2", "-1.2.3", "1.2.3-", "1.2.3-01", ""]) {
      expect(parseVersion(bad), bad).toBeNull()
    }
  })

  test("比较按 major/minor/patch/prerelease 顺序", () => {
    const v = (value: string) => parseVersion(value)!
    expect(compareVersions(v("1.0.0"), v("2.0.0"))).toBe(-1)
    expect(compareVersions(v("1.1.0"), v("1.2.0"))).toBe(-1)
    expect(compareVersions(v("1.0.1"), v("1.0.2"))).toBe(-1)
    expect(compareVersions(v("1.0.0"), v("1.0.0"))).toBe(0)
    expect(compareVersions(v("1.0.0-alpha"), v("1.0.0"))).toBe(-1)
    expect(compareVersions(v("1.0.0-alpha.1"), v("1.0.0-alpha.2"))).toBe(-1)
    expect(compareVersions(v("1.0.0-alpha.1"), v("1.0.0-beta"))).toBe(-1)
    expect(compareVersions(v("1.0.0+build"), v("1.0.0"))).toBe(0)
  })
})

describe("Range 解析与匹配", () => {
  test("精确版本与 x-range", () => {
    expect(satisfiesVersion("1.2.3", "1.2.3")).toBe(true)
    expect(satisfiesVersion("1.2.4", "1.2.3")).toBe(false)
    expect(satisfiesVersion("1.9.9", "1")).toBe(true)
    expect(satisfiesVersion("2.0.0", "1")).toBe(false)
    expect(satisfiesVersion("1.2.9", "1.2")).toBe(true)
    expect(satisfiesVersion("1.3.0", "1.2")).toBe(false)
    expect(satisfiesVersion("1.2.9", "1.2.x")).toBe(true)
    expect(satisfiesVersion("1.3.0", "1.2.x")).toBe(false)
    expect(satisfiesVersion("0.5.0", "*")).toBe(true)
    expect(satisfiesVersion("1.2.3", "x")).toBe(true)
  })

  test("脱字符 ^", () => {
    expect(satisfiesVersion("1.9.9", "^1.2.3")).toBe(true)
    expect(satisfiesVersion("2.0.0", "^1.2.3")).toBe(false)
    expect(satisfiesVersion("0.2.9", "^0.2.3")).toBe(true)
    expect(satisfiesVersion("0.3.0", "^0.2.3")).toBe(false)
    expect(satisfiesVersion("0.0.3", "^0.0.3")).toBe(true)
    expect(satisfiesVersion("0.0.4", "^0.0.3")).toBe(false)
    expect(satisfiesVersion("1.2.2", "^1.2.3")).toBe(false)
  })

  test("波浪 ~", () => {
    expect(satisfiesVersion("1.2.9", "~1.2.3")).toBe(true)
    expect(satisfiesVersion("1.3.0", "~1.2.3")).toBe(false)
    expect(satisfiesVersion("1.2.9", "~1.2")).toBe(true)
    expect(satisfiesVersion("1.9.9", "~1")).toBe(true)
    expect(satisfiesVersion("2.0.0", "~1")).toBe(false)
  })

  test("比较符、交集与并集", () => {
    expect(satisfiesVersion("2.5.0", ">=1.0.0 <3.0.0")).toBe(true)
    expect(satisfiesVersion("3.0.0", ">=1.0.0 <3.0.0")).toBe(false)
    expect(satisfiesVersion("1.0.0", ">1.0.0")).toBe(false)
    expect(satisfiesVersion("1.0.1", ">1.0.0")).toBe(true)
    expect(satisfiesVersion("1.0.0", "<=1.0.0")).toBe(true)
    expect(satisfiesVersion("1.0.0", ">=1.0.0")).toBe(true)
    expect(satisfiesVersion("3.5.0", "^1.0.0 || ^3.0.0")).toBe(true)
    expect(satisfiesVersion("2.0.0", "^1.0.0 || ^3.0.0")).toBe(false)
  })

  test("prerelease 只匹配显式 prerelease range", () => {
    expect(satisfiesVersion("1.0.0-beta.1", "^1.0.0")).toBe(false)
    expect(satisfiesVersion("1.0.0-beta.1", "*")).toBe(false)
    expect(satisfiesVersion("1.0.0-beta.1", ">=1.0.0-beta.1 <2.0.0")).toBe(true)
    expect(satisfiesVersion("1.0.0", ">=1.0.0-beta.1 <2.0.0")).toBe(true)
    expect(satisfiesVersion("1.0.0-rc.1", "^1.0.0-rc.1")).toBe(true)
  })

  test("非法 range 拒绝", () => {
    for (const bad of ["", ">=1.2.3.4", "~", "^", "1.2.3 ||", "abc", "1..2"]) {
      expect(parseRange(bad), bad).toBeNull()
    }
  })

  test("非法输入抛 PluginSdkError", () => {
    expect(() => satisfiesVersion("bad", "^1")).toThrow(/非法版本号/)
    expect(() => satisfiesVersion("1.0.0", "bad")).toThrow(/非法 engine 范围/)
  })
})

describe("pluginApi 兼容性", () => {
  test("当前 SDK 满足 ^1", () => {
    expect(checkPluginApiCompatibility("^1").compatible).toBe(true)
    expect(checkPluginApiCompatibility(">=1.0.0 <2.0.0").compatible).toBe(true)
  })

  test("不兼容与非法 range", () => {
    expect(checkPluginApiCompatibility("^2").compatible).toBe(false)
    expect(checkPluginApiCompatibility("^0.9").compatible).toBe(false)
    expect(checkPluginApiCompatibility("not-a-range").compatible).toBe(false)
  })

  test("PLUGIN_API_VERSION 自身满足 PLUGIN_API_RANGE", () => {
    expect(satisfiesVersion(PLUGIN_API_VERSION, "^1")).toBe(true)
  })
})
