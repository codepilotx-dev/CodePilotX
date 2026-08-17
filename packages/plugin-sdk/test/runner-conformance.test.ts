import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { runRunnerConformance } from "../src/testing/runner-conformance"

const fixturePath = join(import.meta.dir, "../fixtures/runner-fixture.ts")

const run = (env: Record<string, string>, options: { timeoutMs?: number } = {}) =>
  runRunnerConformance({
    executable: process.execPath,
    args: [fixturePath],
    env: { CPX_PLUGIN_ID: "acme.hello", CPX_GENERATION: "g-1", CPX_INSTANCE_TOKEN: "token-1", ...env },
    pluginId: "acme.hello",
    generation: "g-1",
    instanceToken: "token-1",
    ...options,
  })

describe("Runner conformance", () => {
  test("合规 runner 全部检查通过", async () => {
    const report = await run({})
    expect(report.pass).toBe(true)
    expect(report.checks.map((check) => check.name)).toEqual([
      "进程启动",
      "initialize 响应头完整",
      "initialize 返回 capabilities",
      "未知方法返回安全错误 envelope",
      "toolExecute 正常响应",
      "quiesce 正常响应",
      "shutdown 后进程退出",
    ])
    expect(report.checks.every((check) => check.ok)).toBe(true)
  })

  test("initialize 超时导致握手检查失败", async () => {
    const report = await run({ CPX_MODE: "slow-init" }, { timeoutMs: 300 })
    expect(report.pass).toBe(false)
    const init = report.checks.find((check) => check.name === "initialize 握手")
    expect(init?.ok).toBe(false)
    expect(init?.detail).toContain("超时")
  })

  test("缺失协议头的响应被拒绝", async () => {
    const report = await run({ CPX_MODE: "missing-header" })
    expect(report.pass).toBe(false)
    const header = report.checks.find((check) => check.name === "initialize 响应头完整")
    expect(header?.ok).toBe(false)
  })

  test("错误 envelope 携带 stack 字段被视为不安全", async () => {
    const report = await run({ CPX_MODE: "leak-stack" })
    expect(report.pass).toBe(false)
    const envelope = report.checks.find((check) => check.name === "未知方法返回安全错误 envelope")
    expect(envelope?.ok).toBe(false)
    expect(envelope?.detail).toContain("stack")
  })

  test("无法启动的入口返回安全失败", async () => {
    const report = await runRunnerConformance({
      executable: join(import.meta.dir, "no-such-entry-可执行文件"),
      pluginId: "acme.hello",
      generation: "g-1",
    })
    expect(report.pass).toBe(false)
    expect(report.checks[0]?.name).toBe("进程启动")
    expect(report.checks[0]?.ok).toBe(false)
  })
})
