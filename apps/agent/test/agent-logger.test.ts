import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentLogger } from "../src/observability/AgentLogger"

const roots: string[] = []
const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-agent-logger-"))
  roots.push(root)
  return root
}
const records = async (root: string) =>
  (await readFile(join(root, "agent.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)

afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe("AgentLogger", () => {
  test("safe 模式写统一 schema、递归脱敏且终端不包含开发详情", async () => {
    const root = await makeRoot()
    const output: string[] = []
    const logger = new AgentLogger(root, {
      consoleLevel: "debug",
      detailMode: "safe",
      consoleSink: line => output.push(line),
      now: () => new Date("2026-07-25T06:30:00.000Z"),
    })
    const error = new Error("Bearer top-secret")
    logger.error("tool.failed", {
      context: { threadId: "thread-123456789", turnId: "turn-123456789" },
      details: { tool: "PowerShell", error, apiKey: "sk-secret" },
      development: { command: "echo sk-secret" },
    })

    const record = (await records(root))[0]!
    expect(record.component).toBe("agent")
    expect(record.event).toBe("tool.failed")
    expect(record).not.toHaveProperty("development")
    expect(JSON.stringify(record)).not.toContain("top-secret")
    expect(JSON.stringify(record)).not.toContain("sk-secret")
    expect(JSON.stringify(record)).not.toContain("stack")
    expect(output.join("")).toContain("thread=thread-1")
    expect(output.join("")).not.toContain("command")
  })

  test("development 模式只在文件加入脱敏开发详情", async () => {
    const root = await makeRoot()
    const output: string[] = []
    const logger = new AgentLogger(root, {
      consoleLevel: "debug",
      detailMode: "development",
      consoleSink: line => output.push(line),
    })
    logger.info("tool.started", {
      details: { tool: "PowerShell" },
      development: { command: "curl -H 'Authorization=secret' https://example.com" },
    })

    const record = (await records(root))[0]!
    expect(JSON.stringify(record)).toContain("[REDACTED]")
    expect(JSON.stringify(record)).not.toContain("Authorization=secret")
    expect(output.join("")).not.toContain("curl")
  })

  test("只记录失败请求和慢请求", async () => {
    const root = await makeRoot()
    const logger = new AgentLogger(root)
    logger.request({ method: "GET", path: "/api/ready", status: 200, durationMs: 1 })
    logger.request({ method: "POST", path: "/rpc", status: 200, durationMs: 20 })
    logger.request({ method: "POST", path: "/rpc", status: 404, durationMs: 5 })
    logger.request({ method: "GET", path: "/api/ready", status: 200, durationMs: 1_100 })

    expect((await records(root)).map(record => record.event)).toEqual([
      "http.request.failed",
      "http.request.slow",
    ])
  })

  test("RPC 使用适合模型调用的慢请求阈值", async () => {
    const root = await makeRoot()
    const logger = new AgentLogger(root)
    logger.request({ method: "POST", path: "/rpc", status: 200, durationMs: 6_000 })
    logger.request({ method: "POST", path: "/rpc", status: 200, durationMs: 10_000 })

    const logged = await records(root)
    expect(logged).toHaveLength(1)
    expect(logged[0]?.event).toBe("http.request.slow")
    expect(logged[0]?.details).toEqual({
      method: "POST",
      path: "/rpc",
      status: 200,
      durationMs: 10_000,
    })
  })
})
