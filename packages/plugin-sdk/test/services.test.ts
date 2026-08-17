import { describe, expect, test } from "bun:test"
import { isServiceKey, validateServiceDeclaration, validateServiceRequirements } from "../src/services"

describe("Service key 与声明", () => {
  test("key 必须是 publisher.service@major", () => {
    expect(isServiceKey("acme.counter@1")).toBe(true)
    expect(isServiceKey("acme.deep.service-name@3")).toBe(true)
    for (const bad of ["acme.counter", "acme.counter@", "acme@1", "@1", "acme..counter@1", "acme.counter@x", "acme.counter@01"]) {
      expect(isServiceKey(bad), bad).toBe(false)
    }
  })

  test("合法声明通过", () => {
    const result = validateServiceDeclaration({
      key: "acme.counter@1",
      version: "1.2.3",
      description: "计数器",
      singleton: true,
      methods: {
        increment: { input: { type: "object" }, output: { type: "object", properties: { count: { type: "number" } } } },
      },
    })
    expect(result.ok).toBe(true)
  })

  test("非法声明被拒绝", () => {
    const cases = [
      { key: "acme.counter", version: "1.0.0", methods: {} },
      { key: "acme.counter@1", version: "1.0", methods: {} },
      { key: "acme.counter@1", version: "1.0.0", methods: {} },
      { key: "acme.counter@1", version: "1.0.0", methods: { "Bad Name": { input: {}, output: {} } } },
      { key: "acme.counter@1", version: "1.0.0", methods: { inc: { input: { type: "object" }, output: "not-a-schema" } } },
    ]
    for (const input of cases) {
      const result = validateServiceDeclaration(input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
    }
  })

  test("requirements 校验 key 与 range", () => {
    expect(validateServiceRequirements({ services: { "acme.counter@1": "^1.0.0" } }).ok).toBe(true)
    expect(validateServiceRequirements({ optionalServices: { "acme.opt@2": "~2.1.0" } }).ok).toBe(true)
    expect(validateServiceRequirements({ services: { "acme.counter@1": "not-a-range" } }).ok).toBe(false)
    expect(validateServiceRequirements({ services: { "bad-key": "^1.0.0" } }).ok).toBe(false)
  })
})
