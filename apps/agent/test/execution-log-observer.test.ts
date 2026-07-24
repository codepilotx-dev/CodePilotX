import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import type { EventEnvelope } from "../src/domain"
import { AgentLogger } from "../src/observability/AgentLogger"
import { ExecutionLogObserver, HarnessLogObserver } from "../src/observability/ExecutionLogObserver"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-execution-logs-"))
  roots.push(root)
  const logger = new AgentLogger(root, { detailMode: "development" })
  const read = async () => (await readFile(join(root, "agent.jsonl"), "utf8"))
    .trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { logger, read }
}

const event = (method: string, params: unknown): EventEnvelope => ({
  id: 1,
  threadId: "thread-1",
  turnId: "turn-1",
  method,
  params,
  createdAt: 1,
})

describe("execution log observers", () => {
  test("只映射 allowlist 事件且工具详情不包含完整输入输出", async () => {
    const { logger, read } = await setup()
    const observer = new ExecutionLogObserver(logger)
    observer.observeEvent(event("turn/started", {
      turn: { id: "turn-1", rootAgentId: "agent-1", status: "running", mode: "chat" },
      input: { content: "private prompt" },
    }))
    observer.observeEvent(event("tool/callStarted", {
      item: {
        id: "call-1",
        turnID: "turn-1",
        agentID: "agent-1",
        status: "running",
        data: {
          tool: "PowerShell",
          input: { command: "echo token=secret" },
          output: "private output",
        },
      },
    }))
    observer.observeEvent(event("tool/outputDelta", { delta: "private delta" }))
    observer.observeEvent(event("unknown/event", { prompt: "private prompt" }))

    const result = await read()
    expect(result.map(record => record.event)).toEqual(["turn.started", "tool.started"])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("private prompt")
    expect(serialized).not.toContain("private output")
    expect(serialized).not.toContain("private delta")
    expect(serialized).not.toContain("token=secret")
    expect(serialized).toContain("token=[REDACTED]")
  })

  test("provider 多响应递增 attempt，并记录 usage 而非内容", async () => {
    const { logger, read } = await setup()
    let now = 1_000
    const observer = new HarnessLogObserver(logger, () => now)
    const context = { threadId: "thread-1", turnId: "turn-1", agentId: "agent-1" }
    observer.observe(context, {
      type: "before_provider_request",
      model: { provider: "openai", id: "gpt-test" },
      sessionId: "session-1",
      streamOptions: {},
    } as AgentHarnessEvent)
    now = 1_100
    observer.observe(context, { type: "after_provider_response", status: 429, headers: { authorization: "secret" } } as AgentHarnessEvent)
    now = 1_250
    observer.observe(context, { type: "after_provider_response", status: 200, headers: {} } as AgentHarnessEvent)
    observer.observe(context, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "private response" }],
        stopReason: "stop",
        usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
      },
    } as AgentHarnessEvent)

    const result = await read()
    const responses = result.filter(record => record.event === "provider.response")
    expect(responses).toHaveLength(2)
    expect((responses[0]!.details as Record<string, unknown>).attempt).toBe(1)
    expect((responses[1]!.details as Record<string, unknown>).attempt).toBe(2)
    expect(JSON.stringify(result)).not.toContain("private response")
    expect(JSON.stringify(result)).not.toContain("authorization")
  })
})
