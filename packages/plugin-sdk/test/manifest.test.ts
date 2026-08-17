import { describe, expect, test } from "bun:test"
import { parseManifest, validateManifest, MANIFEST_TOP_LEVEL_FIELDS } from "../src/manifest"

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
  files: { "index.ts": "a".repeat(64), "manifest.json": "b".repeat(64) },
  ...overrides,
})

describe("Manifest v1 校验", () => {
  test("合法 manifest 通过且保留原值", () => {
    const fixture = validManifest()
    const result = validateManifest(fixture)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.id).toBe("acme.hello")
      expect(result.manifest.files["index.ts"]).toBe("a".repeat(64))
    }
  })

  test("application 插件不能声明 system runtime", () => {
    const result = validateManifest(validManifest({
      tier: "application",
      runtime: { kind: "system", entry: "index.ts" },
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((item) => item.code === "TIER_RUNTIME_MISMATCH")).toBe(true)
  })

  test("system 插件不能声明 process/declarative runtime", () => {
    for (const runtime of [
      { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "index.ts" },
      { kind: "declarative" },
    ]) {
      const result = validateManifest(validManifest({ tier: "system", runtime }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.some((item) => item.code === "TIER_RUNTIME_MISMATCH")).toBe(true)
    }
  })

  test("system 插件合法声明", () => {
    const result = validateManifest(validManifest({
      tier: "system",
      runtime: { kind: "system", entry: "index.ts" },
    }))
    expect(result.ok).toBe(true)
  })

  test("非法 plugin id 被拒绝", () => {
    for (const id of ["hello", "acme.", ".hello", "acme..hello", "a".repeat(200), "acme/hello"]) {
      const result = validateManifest(validManifest({ id }))
      expect(result.ok, id).toBe(false)
      if (!result.ok) expect(result.errors[0]?.code).toBe("INVALID_PLUGIN_ID")
    }
  })

  test("非法 SemVer 被拒绝", () => {
    for (const version of ["1.0", "1", "latest", "1.0.0.1", "v1.0.0"]) {
      const result = validateManifest(validManifest({ version }))
      expect(result.ok, version).toBe(false)
      if (!result.ok) expect(result.errors[0]?.code).toBe("INVALID_SEMVER")
    }
  })

  test("不支持的 schemaVersion 被拒绝", () => {
    const result = validateManifest(validManifest({ schemaVersion: 2 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.code).toBe("UNSUPPORTED_SCHEMA_VERSION")
  })

  test("engine range 非法或不兼容被拒绝", () => {
    const invalid = validateManifest(validManifest({ engines: { pluginApi: "not-a-range" } }))
    expect(invalid.ok).toBe(false)
    const incompatible = validateManifest(validManifest({ engines: { pluginApi: "^2" } }))
    expect(incompatible.ok).toBe(false)
    if (!incompatible.ok) expect(incompatible.errors[0]?.code).toBe("ENGINE_INCOMPATIBLE")
  })

  test("unknown 顶层字段与贡献类型被拒绝", () => {
    const unknownField = validateManifest(validManifest({ extra: true }))
    expect(unknownField.ok).toBe(false)
    if (!unknownField.ok) expect(unknownField.errors.some((item) => item.code === "UNKNOWN_MANIFEST_FIELD")).toBe(true)

    const unknownContribution = validateManifest(validManifest({
      contributes: { custom: [] },
    }))
    expect(unknownContribution.ok).toBe(false)
    if (!unknownContribution.ok) expect(unknownContribution.errors.some((item) => item.code === "UNKNOWN_CONTRIBUTION")).toBe(true)
  })

  test("files 校验：非法路径与哈希被拒绝", () => {
    const badPath = validateManifest(validManifest({ files: { "../escape.ts": "a".repeat(64) } }))
    expect(badPath.ok).toBe(false)
    const absolute = validateManifest(validManifest({ files: { "/abs.ts": "a".repeat(64) } }))
    expect(absolute.ok).toBe(false)
    const badHash = validateManifest(validManifest({ files: { "index.ts": "not-a-hash" } }))
    expect(badHash.ok).toBe(false)
    if (!badPath.ok) expect(badPath.errors[0]?.code).toBe("INVALID_FILE_PATH")
    if (!badHash.ok) expect(badHash.errors[0]?.code).toBe("INVALID_FILE_HASH")
  })

  test("插件工具不能声明 never-review", () => {
    const result = validateManifest(validManifest({
      contributes: {
        tools: [{
          name: "run",
          description: "run something",
          inputSchema: { type: "object" },
          approvalStrategy: "never-review",
        }],
      },
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((item) => item.code === "INVALID_MANIFEST")).toBe(true)
  })

  test("service requires 的 key 与 range 被校验", () => {
    const badKey = validateManifest(validManifest({
      requires: { services: { "no-at-sign": "^1.0.0" } },
    }))
    expect(badKey.ok).toBe(false)
    if (!badKey.ok) expect(badKey.errors.some((item) => item.code === "INVALID_MANIFEST")).toBe(true)

    const badRange = validateManifest(validManifest({
      requires: { services: { "acme.counter@1": "not-a-range" } },
    }))
    expect(badRange.ok).toBe(false)

    const ok = validateManifest(validManifest({
      requires: { services: { "acme.counter@1": "^1.2.0" }, optionalServices: { "acme.optional@1": "~1.0.0" } },
    }))
    expect(ok.ok).toBe(true)
  })

  test("full contributes fixture 通过", () => {
    const fixture = validManifest({
      contributes: {
        tools: [{
          name: "hello",
          description: "打招呼",
          inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
          approvalStrategy: "policy",
          visibility: "deferred",
          capabilities: { filesystem: "none", network: "none", process: false, externalState: false, userInteraction: false },
        }],
        skills: [{ root: "skills/hello" }],
        mcpServers: [{
          name: "fixture-mcp",
          transport: { kind: "stdio", command: "bun", args: ["server.ts"] },
          toolPolicy: { allow: ["read"] },
        }],
        promptCommands: [{ id: "hello", title: "打招呼", promptTemplate: "请向用户问好" }],
        settings: [{ key: "greeting", title: "问候语", control: "string", default: "你好" }],
        workbenchViews: [{ id: "hello-view", title: "Hello" }],
        services: [{
          key: "acme.counter@1",
          version: "1.0.0",
          methods: { increment: { input: { type: "object" }, output: { type: "object" } } },
        }],
      },
      permissions: [{ id: "network.request", reason: "示例", scope: "workspace" }],
      configSchema: { type: "object", properties: { mode: { type: "string" } } },
    })
    const result = validateManifest(fixture)
    expect(result.ok).toBe(true)
  })

  test("parseManifest 断言版本抛 PluginSdkError", () => {
    expect(() => parseManifest(validManifest({ id: "bad" }))).toThrow()
  })

  test("顶层字段白名单与 JSON Schema 一致（测试侧锚点）", () => {
    // 常量至少包含全部固定字段，防止误删。
    expect(MANIFEST_TOP_LEVEL_FIELDS).toContain("schemaVersion")
    expect(MANIFEST_TOP_LEVEL_FIELDS).toContain("files")
    expect(MANIFEST_TOP_LEVEL_FIELDS).toContain("runtime")
  })
})
