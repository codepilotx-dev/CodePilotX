/**
 * Plugin SDK engine 兼容层：SemVer 版本与 npm 风格范围的最小实现。
 *
 * 不依赖运行时提供的 semver 库，保证 TypeScript SDK 在 Bun 与 Node 下行为一致，
 * 并与未来跨语言实现保持同一匹配语义。
 *
 * 支持的 range 语法（npm 语义子集）：
 *   - 精确版本：1.2.3
 *   - 裸版本 = x-range：1、1.2（含 1.x、1.2.x、*、x、空 range）
 *   - 比较符：>=、<=、>、<、=（= 等价精确或 x-range）
 *   - 脱字符 ^：^1.2.3、^0.2.3、^0.0.3
 *   - 波浪 ~：~1.2.3、~1.2、~1
 *   - 空格 = 交集；|| = 并集
 *   - prerelease 版本只匹配显式包含 prerelease 的 range（npm 规则）
 */

import { PluginSdkError } from "./errors"

export interface SemVer {
  major: number
  minor: number
  patch: number
  /** prerelease 标识列表；无 prerelease 时为 null。 */
  prerelease: readonly (string | number)[] | null
  build: string | null
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/

/** 解析严格 SemVer（major.minor.patch 必需）；非法返回 null。 */
export function parseVersion(input: string): SemVer | null {
  const match = VERSION_PATTERN.exec(input.trim())
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (major > 2 ** 31 || minor > 2 ** 31 || patch > 2 ** 31) return null
  const prerelease = match[4] ? parsePrerelease(match[4]) : null
  if (match[4] && prerelease === null) return null
  return {
    major,
    minor,
    patch,
    prerelease,
    build: match[5] ?? null,
  }
}

const parsePrerelease = (raw: string): (string | number)[] | null => {
  const parts = raw.split(".")
  const result: (string | number)[] = []
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      // npm 语义：数字标识禁止 leading zero。
      if (part.length > 1 && part.startsWith("0")) return null
      result.push(Number(part))
    } else {
      result.push(part)
    }
  }
  return result
}

/** 数值/字符串混合 prerelease 比较（npm 语义：数字 < 字母）。 */
const comparePrerelease = (
  left: readonly (string | number)[] | null,
  right: readonly (string | number)[] | null,
): number => {
  if (left === null && right === null) return 0
  if (left === null) return 1 // 无 prerelease 的版本更大
  if (right === null) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined && b === undefined) return 0
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (typeof a === "number" && typeof b === "number") {
      if (a !== b) return a < b ? -1 : 1
    } else if (typeof a === "string" && typeof b === "string") {
      if (a !== b) return a < b ? -1 : 1
    } else {
      // 数字恒小于字母
      return typeof a === "number" ? -1 : 1
    }
  }
  return 0
}

/** build 元数据不参与优先级比较（npm 语义）。 */
export function compareVersions(left: SemVer, right: SemVer): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

type ComparatorOperator = ">=" | "<=" | ">" | "<" | "=" | "^" | "~"

interface Comparator {
  operator: ComparatorOperator
  version: SemVer
}

interface RangePart {
  /** 空数组表示 *（任意版本，不含 prerelease）。 */
  comparators: Comparator[]
  /** 是否显式包含 prerelease 标识；控制 prerelease 版本匹配。 */
  explicitPrerelease: boolean
}

/** 解析 range 为 comparator 并集；非法返回 null。 */
export function parseRange(input: string): RangePart[] | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s*\|\|\s*/)
  if (parts.some((part) => part === "")) return null
  const result: RangePart[] = []
  for (const part of parts) {
    const comparators: Comparator[] = []
    let explicitPrerelease = false
    let anyToken = false
    for (const token of part.trim().split(/\s+/)) {
      if (token === "") continue
      anyToken = true
      const parsed = parseComparator(token)
      if (!parsed) return null
      if (parsed.prerelease) explicitPrerelease = true
      comparators.push(...parsed.comparators)
    }
    if (!anyToken) {
      // 空段（如 "1.0.0 ||" 的尾段在拆分后不存在；这里覆盖 " " 输入）
      result.push({ comparators: [], explicitPrerelease: false })
    } else {
      result.push({ comparators, explicitPrerelease })
    }
  }
  return result
}

interface ParsedComparator {
  comparators: Comparator[]
  prerelease: boolean
}

const COMPARATOR_PATTERN = /^(>=|<=|>|<|=|\^|~)?([0-9xX*]+)(?:\.([0-9xX*]+))?(?:\.([0-9xX*]+))?(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/

const isWildcard = (value: string | undefined) => value === undefined || value === "x" || value === "X" || value === "*"

const parseComparator = (token: string): ParsedComparator | null => {
  const match = COMPARATOR_PATTERN.exec(token)
  if (!match) return null
  const rawOperator = match[1] ?? "="
  if (!["=", "^", "~", ">=", "<=", ">", "<"].includes(rawOperator)) return null
  const operator = rawOperator as ComparatorOperator
  const rawMajor = match[2]!
  const minor = match[3]
  const patch = match[4]
  const prereleaseRaw = match[5]
  const buildRaw = match[6]
  const prerelease = prereleaseRaw !== undefined

  const version = (major: number, minorValue: number, patchValue: number): SemVer => ({
    major,
    minor: minorValue,
    patch: patchValue,
    prerelease: prereleaseRaw ? parsePrerelease(prereleaseRaw) : null,
    build: buildRaw ?? null,
  })

  // 纯通配 * / x：任何稳定版本。
  if (isWildcard(rawMajor)) {
    if (!isWildcard(minor) || !isWildcard(patch)) return null
    if (operator !== "=") return null
    return { comparators: [], prerelease: false }
  }

  const major = Number(rawMajor)
  if (!Number.isInteger(major) || major < 0) return null
  const hasMinor = !isWildcard(minor)
  const hasPatch = !isWildcard(patch)
  const minorValue = hasMinor ? Number(minor) : 0
  const patchValue = hasPatch ? Number(patch) : 0
  if (Number.isNaN(minorValue) || Number.isNaN(patchValue)) return null

  // x-range：1、1.2、1.x、1.2.x 展开为 [>=lower, <upper)；
  // ^/~ 与缺失段组合按 npm 语义展开（~1 → >=1.0.0 <2.0.0，^1.2 → >=1.2.0 <2.0.0）。
  if (!hasMinor || !hasPatch) {
    if (operator === "=") {
      const lower = version(major, hasMinor ? minorValue : 0, hasPatch ? patchValue : 0)
      const upper = hasPatch
        ? version(major, minorValue, patchValue + 1)
        : hasMinor
          ? version(major, minorValue + 1, 0)
          : version(major + 1, 0, 0)
      return {
        comparators: [
          { operator: ">=", version: lower },
          { operator: "<", version: upper },
        ],
        prerelease,
      }
    }
    if (operator === "~") {
      const lower = version(major, hasMinor ? minorValue : 0, 0)
      const upper = hasMinor
        ? version(major, minorValue + 1, 0)
        : version(major + 1, 0, 0)
      return {
        comparators: [
          { operator: ">=", version: lower },
          { operator: "<", version: upper },
        ],
        prerelease,
      }
    }
    if (operator === "^") {
      const lower = version(major, hasMinor ? minorValue : 0, 0)
      const upper = major > 0
        ? version(major + 1, 0, 0)
        : hasMinor && minorValue > 0
          ? version(0, minorValue + 1, 0)
          : version(0, 0, 1)
      return {
        comparators: [
          { operator: ">=", version: lower },
          { operator: "<", version: upper },
        ],
        prerelease,
      }
    }
    return null
  }

  const base = version(major, minorValue, patchValue)

  switch (operator) {
    case "^": {
      const upper =
        base.major > 0
          ? version(base.major + 1, 0, 0)
          : base.minor > 0
            ? version(0, base.minor + 1, 0)
            : version(0, 0, base.patch + 1)
      return {
        comparators: [
          { operator: ">=", version: base },
          { operator: "<", version: upper },
        ],
        prerelease,
      }
    }
    case "~": {
      const upper = version(base.major, base.minor + 1, 0)
      return {
        comparators: [
          { operator: ">=", version: base },
          { operator: "<", version: upper },
        ],
        prerelease,
      }
    }
    default:
      return { comparators: [{ operator, version: base }], prerelease }
  }
}

/** 判定 version 是否满足 range；range 非法时抛 PluginSdkError。 */
export function satisfiesVersion(versionInput: string, rangeInput: string): boolean {
  const version = parseVersion(versionInput)
  if (!version) throw new PluginSdkError({ code: "INVALID_SEMVER", message: `非法版本号：${versionInput}` })
  const range = parseRange(rangeInput)
  if (!range) throw new PluginSdkError({ code: "INVALID_ENGINE_RANGE", message: `非法 engine 范围：${rangeInput}` })
  return range.some((part) => satisfiesPart(version, part))
}

const satisfiesPart = (version: SemVer, part: RangePart): boolean => {
  if (part.comparators.length === 0) {
    // *：任意稳定版本；prerelease 版本按 npm 规则不匹配。
    return version.prerelease === null
  }
  if (version.prerelease !== null && !part.explicitPrerelease) return false
  return part.comparators.every((comparator) => satisfiesComparator(version, comparator))
}

const satisfiesComparator = (version: SemVer, comparator: Comparator): boolean => {
  switch (comparator.operator) {
    case ">=":
      return compareVersions(version, comparator.version) >= 0
    case "<=":
      return compareVersions(version, comparator.version) <= 0
    case ">":
      return compareVersions(version, comparator.version) > 0
    case "<":
      return compareVersions(version, comparator.version) < 0
    case "=":
      return compareVersions(version, comparator.version) === 0
    case "^": {
      const base = comparator.version
      const upper =
        base.major > 0
          ? { major: base.major + 1, minor: 0, patch: 0, prerelease: null, build: null }
          : base.minor > 0
            ? { major: 0, minor: base.minor + 1, patch: 0, prerelease: null, build: null }
            : { major: 0, minor: 0, patch: base.patch + 1, prerelease: null, build: null }
      return compareVersions(version, base) >= 0 && compareVersions(version, upper) < 0
    }
    case "~": {
      const base = comparator.version
      const upper = { major: base.major, minor: base.minor + 1, patch: 0, prerelease: null, build: null }
      return compareVersions(version, base) >= 0 && compareVersions(version, upper) < 0
    }
  }
}

/**
 * 当前 SDK 实现的 pluginApi 版本。Manifest 的 engines.pluginApi 必须匹配
 * PLUGIN_API_RANGE（当前为 "^1"），以保证 wire 与贡献 ABI 兼容。
 */
export const PLUGIN_API_VERSION = "1.0.0"
export const PLUGIN_API_RANGE = "^1"

/** 校验 engine range 并判断与当前 SDK 的 pluginApi 兼容。 */
export function checkPluginApiCompatibility(rangeInput: string): { compatible: boolean; error: PluginSdkError | null } {
  const range = parseRange(rangeInput)
  if (!range) {
    return { compatible: false, error: new PluginSdkError({ code: "INVALID_ENGINE_RANGE", message: `非法 engine 范围：${rangeInput}` }) }
  }
  const version = parseVersion(PLUGIN_API_VERSION)!
  const ok = range.some((part) => satisfiesPart(version, part))
  if (!ok) {
    return {
      compatible: false,
      error: new PluginSdkError({
        code: "ENGINE_INCOMPATIBLE",
        message: `插件要求 pluginApi ${rangeInput}，当前 SDK 为 ${PLUGIN_API_VERSION}`,
        retryable: false,
      }),
    }
  }
  return { compatible: true, error: null }
}
