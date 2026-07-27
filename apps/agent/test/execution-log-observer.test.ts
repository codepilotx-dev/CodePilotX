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
  test("只映射 allowlist 事件，Shell 仅记录安全元数据且不包含完整输入输出", async () => {
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
          input: {
            command: "echo token=secret",
            cwd: "C:\\Users\\private\\workspace",
            timeout: 12_345,
            env: { OPENAI_API_KEY: "sk-private" },
          },
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
    expect(serialized).not.toContain("echo")
    expect(serialized).not.toContain("Users")
    expect(serialized).not.toContain("OPENAI_API_KEY")
    expect(serialized).not.toContain("sk-private")
    expect(result[1]).not.toHaveProperty("development")
    expect(result[1]!.details).toMatchObject({
      tool: "PowerShell",
      commandBytes: Buffer.byteLength("echo token=secret", "utf8"),
      cwdScope: "absolute",
      timeoutMs: 12_345,
    })
  })

  test("Write、Edit 和 apply_patch 只投影安全路径、字节数与统计", async () => {
    const { logger, read } = await setup()
    const observer = new ExecutionLogObserver(logger)
    observer.observeEvent(event("tool/callStarted", {
      item: {
        id: "write-1",
        status: "running",
        data: {
          tool: "workspace.write",
          input: {
            file_path: "src/new.ts",
            content: "const apiKey = 'sk-private'",
          },
        },
      },
    }))
    observer.observeEvent(event("tool/callStarted", {
      item: {
        id: "edit-1",
        status: "running",
        data: {
          tool: "Edit",
          input: {
            path: "C:\\Users\\private\\secret.ts",
            edits: [
              { oldText: "password=before", newText: "password=after" },
              { oldText: "token=before", newText: "token=after" },
            ],
          },
        },
      },
    }))
    observer.observeEvent(event("tool/callCompleted", {
      item: {
        id: "patch-1",
        status: "completed",
        data: {
          tool: "apply_patch",
          durationMs: 42,
          input: {
            operation: "apply_patch",
            patch: "[补丁正文已隐藏]",
            patchBytes: 321,
            affectedPaths: [
              { path: "src/a.ts", operation: "update" },
              { path: "C:\\Users\\private\\added.ts", operation: "create" },
            ],
            fileCount: 2,
            hunkCount: 3,
            additions: 7,
            deletions: 2,
          },
          output: "private stdout",
        },
      },
    }))

    const result = await read()
    expect(result.map(record => record.event)).toEqual([
      "tool.started",
      "tool.started",
      "tool.completed",
    ])
    expect(result[0]!.details).toMatchObject({
      tool: "workspace.write",
      path: "src/new.ts",
      fileCount: 1,
      contentBytes: Buffer.byteLength("const apiKey = 'sk-private'", "utf8"),
    })
    expect(result[1]!.details).toMatchObject({
      tool: "Edit",
      path: "[outside-workspace]",
      fileCount: 1,
      editCount: 2,
      oldTextBytes: Buffer.byteLength("password=beforetoken=before", "utf8"),
      newTextBytes: Buffer.byteLength("password=aftertoken=after", "utf8"),
    })
    expect(result[2]!.details).toMatchObject({
      tool: "apply_patch",
      durationMs: 42,
      affectedPaths: [
        { path: "src/a.ts", operation: "update" },
        { path: "[outside-workspace]", operation: "create" },
      ],
      fileCount: 2,
      createCount: 1,
      updateCount: 1,
      patchBytes: 321,
      hunkCount: 3,
      additions: 7,
      deletions: 2,
    })
    const serialized = JSON.stringify(result)
    for (const forbidden of [
      "const apiKey",
      "sk-private",
      "password=before",
      "password=after",
      "token=before",
      "token=after",
      "Users",
      "补丁正文",
      "private stdout",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
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
