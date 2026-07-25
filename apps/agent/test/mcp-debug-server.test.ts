import { afterEach, describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { McpClientFactory } from "../src/mcp/McpClientFactory"

const connections: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()))
})

describe("MCP debug server", () => {
  test("captures calls and runs a deterministic scripted conversation over stdio", async () => {
    const connection = await new McpClientFactory().connect({
      name: "codepilotx-debug",
      scope: "user",
      enabled: true,
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [resolve(import.meta.dir, "../scripts/mcp-debug-server.ts"), "--transport=stdio"],
      },
      startupTimeoutMs: 20_000,
    }, () => undefined)
    connections.push(connection)

    expect(connection.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "capture",
        "assert_value",
        "conversation_configure",
        "conversation_send",
        "conversation_history",
        "large_result",
        "change_tools",
        "disconnect",
      ]),
    )

    await connection.callTool("conversation_configure", {
      channel: "review",
      replies: ["ask-details", "done"],
      loop: false,
    })
    const first = await connection.callTool("conversation_send", {
      channel: "review",
      message: "start",
    })
    expect(first.content).toMatchObject([
      { type: "text", text: expect.stringContaining("ask-details") },
    ])

    const history = await connection.callTool("conversation_history", {
      channel: "review",
      cursor: 0,
      limit: 20,
    })
    expect(history.content).toMatchObject([
      { type: "text", text: expect.stringContaining("\"role\":\"client\"") },
    ])

    const capture = await connection.callTool("capture", {
      label: "checkpoint",
      message: "conversation reached the first reply",
    })
    expect(capture.structuredContent).toMatchObject({
      captured: true,
      callId: expect.stringMatching(/^call-\d+$/),
    })

    const calls = await connection.readResource("debug://calls")
    expect(calls.contents).toMatchObject([
      {
        uri: "debug://calls",
        text: expect.stringContaining("\"tool\": \"capture\""),
      },
    ])

    await connection.callTool("change_tools", { enabled: true })
    const dynamic = await connection.callTool("dynamic_echo", { value: "dynamic-ok" })
    expect(dynamic.content).toMatchObject([
      { type: "text", text: "dynamic-ok" },
    ])
  }, 30_000)
})
