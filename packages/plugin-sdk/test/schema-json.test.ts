import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Ajv from "ajv"
import { MANIFEST_TOP_LEVEL_FIELDS, validateManifest } from "../src/manifest"
import { applicationWireV1JsonSchema, manifestV1JsonSchema } from "../src/schema"

const ajv = new Ajv({ strict: false, allErrors: true })

const validManifest = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: "acme.hello",
  version: "1.0.0",
  displayName: "Hello Plugin",
  description: "示例插件",
  publisher: "acme",
  engines: { pluginApi: "^1" },
  tier: "application",
  runtime: { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "index.ts" },
  files: { "index.ts": "a".repeat(64) },
  ...overrides,
})

describe("JSON Schema 文档", () => {
  test("Manifest JSON Schema 是合法 draft-07 文档", () => {
    const validate = ajv.compile(manifestV1JsonSchema)
    // 文档自身可编译；用空对象冒烟。
    expect(validate({})).toBe(false)
  })

  test("顶层字段集合与 TS 类型白名单一致", () => {
    const schemaKeys = Object.keys(manifestV1JsonSchema.properties ?? {}).sort()
    const typeKeys = [...MANIFEST_TOP_LEVEL_FIELDS].sort()
    expect(schemaKeys).toEqual(typeKeys)
  })

  test("合法 fixture 在 SDK 与 JSON Schema 下都通过", () => {
    const fixture = validManifest()
    const validate = ajv.compile(manifestV1JsonSchema)
    expect(validate(fixture)).toBe(true)
    expect(validateManifest(fixture).ok).toBe(true)
  })

  test("结构非法 fixture 在 SDK 与 JSON Schema 下都拒绝", () => {
    const cases = [
      validManifest({ id: "no-publisher" }),
      validManifest({ version: "1.0" }),
      validManifest({ files: { "a.ts": "not-a-hash" } }),
      validManifest({ runtime: { kind: "process", protocol: "cpx-plugin-rpc@1" } }),
      validManifest({ extraField: 1 }),
      validManifest({ contributes: { tools: [{ name: "x" }] } }),
    ]
    const validate = ajv.compile(manifestV1JsonSchema)
    for (const input of cases) {
      const sdk = validateManifest(input)
      const schema = validate(input)
      expect(schema, JSON.stringify(input)).toBe(false)
      expect(sdk.ok, JSON.stringify(input)).toBe(false)
    }
  })

  test("tier/runtime 一致性是 SDK 独有校验（JSON Schema 无法表达跨字段约束）", () => {
    const fixture = validManifest({ tier: "system", runtime: { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "x.ts" } })
    const validate = ajv.compile(manifestV1JsonSchema)
    expect(validate(fixture)).toBe(true)
    expect(validateManifest(fixture).ok).toBe(false)
  })

  test("engine 语义差异是 SDK 独有校验（JSON Schema 只约束字符串形状）", () => {
    // JSON Schema 无法表达 engine range 语义；SDK 必须拒绝不兼容 range。
    const fixture = validManifest({ engines: { pluginApi: "^2" } })
    const validate = ajv.compile(manifestV1JsonSchema)
    expect(validate(fixture)).toBe(true)
    expect(validateManifest(fixture).ok).toBe(false)
  })

  test("wire JSON Schema 接受合法消息并拒绝缺字段消息", () => {
    const validate = ajv.compile(applicationWireV1JsonSchema)
    const ok = {
      protocol: "cpx-plugin-rpc@1",
      version: 1,
      pluginId: "acme.hello",
      generation: "g-1",
      kind: "request",
      method: "plugin/toolExecute",
      requestId: "r1",
      params: { name: "world" },
    }
    expect(validate(ok)).toBe(true)
    expect(validate({ ...ok, requestId: 123 })).toBe(false)
    expect(validate({ ...ok, kind: "bogus" })).toBe(false)
  })

  test("生成的 schema/*.json 与当前文档一致", () => {
    const root = join(import.meta.dir, "..")
    const manifestFile = join(root, "schema", "plugin-manifest.v1.schema.json")
    const wireFile = join(root, "schema", "application-wire.v1.schema.json")
    expect(JSON.parse(readFileSync(manifestFile, "utf8"))).toEqual(manifestV1JsonSchema)
    expect(JSON.parse(readFileSync(wireFile, "utf8"))).toEqual(applicationWireV1JsonSchema)
  })
})
