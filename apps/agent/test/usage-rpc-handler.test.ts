import { describe, expect, test } from "bun:test"
import { usageHandlers } from "../src/transport/rpc/handlers/usage"

describe("usage RPC handler", () => {
  test("解码四个 canonical RPC 并拒绝非法时区", async () => {
    const calls: unknown[] = []
    const runtime = {
      dependencies: {
        usage: {
          localUsage: (...args: unknown[]) => { calls.push(["local", ...args]); return { ok: true } },
          providerUsage: (...args: unknown[]) => { calls.push(["provider", ...args]); return { ok: true } },
          connect: (...args: unknown[]) => { calls.push(["connect", ...args]); return { ok: true } },
          disconnect: (...args: unknown[]) => { calls.push(["disconnect", ...args]); return { ok: true } },
        },
      },
    }
    await usageHandlers.handle(runtime as never, "usage/local/get", { range: "30d", timeZone: "Asia/Shanghai" }, {})
    await usageHandlers.handle(runtime as never, "usage/provider/query", { range: "7d", timeZone: "UTC", force: true }, {})
    await usageHandlers.handle(runtime as never, "usage/credential/connect", {
      sourceId: "openai-admin", key: "secret", operationId: "op-1",
    }, {})
    await usageHandlers.handle(runtime as never, "usage/credential/disconnect", {
      sourceId: "openai-admin", operationId: "op-2",
    }, {})
    expect(calls.map((item) => (item as unknown[])[0])).toEqual(["local", "provider", "connect", "disconnect"])
    await expect(usageHandlers.handle(runtime as never, "usage/provider/query", {
      range: "7d", timeZone: "not/a-real-zone",
    }, {})).rejects.toThrow()
  })
})
