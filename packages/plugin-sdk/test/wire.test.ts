import { describe, expect, test } from "bun:test"
import { PluginSdkError } from "../src/errors"
import { canonicalDigest, canonicalStringify, decodeMessage, encodeMessage, toJsonValue } from "../src/wire/codec"
import { MAX_MESSAGE_BYTES, type PluginMessage } from "../src/wire/messages"

describe("canonical JSON 与 digest", () => {
  test("digest 与对象 key 顺序无关", () => {
    const left = canonicalDigest({ a: 1, b: { c: "x", d: [1, 2] } })
    const right = canonicalDigest({ b: { d: [1, 2], c: "x" }, a: 1 })
    expect(left).toBe(right)
    expect(canonicalStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}')
    expect(canonicalStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  test("数组顺序保留，无多余空白", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]")
    expect(canonicalStringify({ list: [1, "a", null, true] })).toBe('{"list":[1,"a",null,true]}')
    expect(canonicalStringify({ s: "a\nb" })).toBe('{"s":"a\\nb"}')
  })

  test("拒绝非 JSON 类型", () => {
    const cases: unknown[] = [
      undefined,
      () => undefined,
      Symbol("x"),
      BigInt(1),
      NaN,
      Infinity,
      { nested: undefined },
      { fn: () => undefined },
      { big: BigInt(2) },
    ]
    for (const value of cases) {
      expect(() => canonicalStringify(value as never), String(value)).toThrow()
    }
  })

  test("拒绝循环引用", () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(() => canonicalStringify(value as never)).toThrow()
  })

  test("toJsonValue 拒绝非 JSON 输入", () => {
    expect(toJsonValue({ ok: 1 })).toEqual({ ok: 1 })
    expect(() => toJsonValue(() => undefined)).toThrow()
    expect(() => toJsonValue(undefined)).toThrow()
  })
})

describe("wire 消息编解码", () => {
  const header = { protocol: "cpx-plugin-rpc@1" as const, version: 1 as const, pluginId: "acme.hello", generation: "g-1" }

  test("request/response 往返", () => {
    const request: PluginMessage = { ...header, kind: "request", requestId: "r1", method: "plugin/toolExecute", params: { tool: "hello" } }
    const text = encodeMessage(request)
    const decoded = decodeMessage(text)
    expect(decoded).toEqual(request)

    const response: PluginMessage = { ...header, kind: "response", requestId: "r1", result: { ok: true } }
    expect(decodeMessage(encodeMessage(response))).toEqual(response)
  })

  test("notification 无需 requestId", () => {
    const message: PluginMessage = { ...header, kind: "clientNotification", method: "host/log", params: { level: "info", message: "hi" } }
    const decoded = decodeMessage(encodeMessage(message))
    expect(decoded.kind).toBe("clientNotification")
  })

  test("协议版本不兼容被拒绝", () => {
    const bad = { ...header, protocol: "cpx-plugin-rpc@2", kind: "notification" as const, method: "host/log" }
    expect(() => encodeMessage(bad as never)).toThrow()
    const text = JSON.stringify({ ...header, protocol: "cpx-plugin-rpc@2", kind: "notification", method: "host/log" })
    expect(() => decodeMessage(text)).toThrow()
  })

  test("缺少 requestId 的请求被拒绝", () => {
    const text = JSON.stringify({ ...header, kind: "request", method: "plugin/toolExecute" })
    expect(() => decodeMessage(text)).toThrow()
  })

  test("超过 1 MiB 的消息被拒绝", () => {
    const huge = { ...header, kind: "clientNotification" as const, method: "host/log" as const, params: { blob: "x".repeat(MAX_MESSAGE_BYTES) } }
    expect(() => encodeMessage(huge)).toThrow()
    expect(() => encodeMessage(huge)).toThrowError(expect.objectContaining({ code: "MESSAGE_TOO_LARGE" }))
  })

  test("错误只携带安全 envelope", () => {
    const error = new PluginSdkError({ code: "RPC_TIMEOUT", message: "超时", retryable: true })
    expect(error.toWire()).toEqual({ code: "RPC_TIMEOUT", message: "超时", retryable: true })
    expect(JSON.stringify(error.toWire())).not.toContain("stack")
  })
})
