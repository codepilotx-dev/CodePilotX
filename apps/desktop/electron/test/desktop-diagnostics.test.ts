import { describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDiagnosticLineDecoder, publishAgentDiagnostic, sanitizeAgentDiagnostic } from "../src/desktop-diagnostics.js"
import { createDesktopLogger } from "../src/desktop-logger.js"

describe("desktop diagnostic bridge", () => {
  test("reconstructs only the renderer-safe diagnostic fields", () => {
    const diagnostic = sanitizeAgentDiagnostic({
      at: "2026-07-22T03:00:00.000Z",
      level: "warn",
      source: "agent",
      code: "SANDBOX_SETUP_TIMEOUT",
      message: "沙箱初始化超时",
      token: "must-not-cross",
      details: {
        phase: "acl",
        durationMs: 75_000,
        toolCallId: "tool-1",
        command: "must-not-cross",
      },
    })

    expect(diagnostic).toEqual({
      at: "2026-07-22T03:00:00.000Z",
      level: "warn",
      source: "agent",
      code: "SANDBOX_SETUP_TIMEOUT",
      message: "沙箱初始化超时",
      details: { phase: "acl", durationMs: 75_000, toolCallId: "tool-1" },
    })
  })

  test("publishes only valid diagnostics", () => {
    const sent: unknown[] = []
    const target = { send: (channel: string, value: unknown) => sent.push([channel, value]) }
    expect(publishAgentDiagnostic(target, { level: "debug" })).toBe(false)
    expect(publishAgentDiagnostic(target, {
      at: "2026-07-22T03:00:00.000Z",
      level: "error",
      source: "desktop",
      code: "AGENT_UNAVAILABLE",
      message: "Agent 暂不可用",
    })).toBe(true)
    expect(sent).toHaveLength(1)
  })

  test("decodes only known sandbox lifecycle records across stderr chunks", () => {
    const decoder = new AgentDiagnosticLineDecoder()
    expect(decoder.push("unrelated stderr\n[CodePilotX Agent] {\"at\":\"2026-07-22T03:00:00.000Z\",\"level\":\"error\","))
      .toEqual([])
    expect(decoder.push("\"event\":\"sandbox.worker.timeout\",\"details\":{\"code\":\"SANDBOX_SETUP_TIMEOUT\",\"phase\":\"setup\",\"durationMs\":75000,\"toolCallID\":\"tool-1\",\"command\":\"must-not-cross\"}}\n"))
      .toEqual([{
        at: "2026-07-22T03:00:00.000Z",
        level: "error",
        source: "agent",
        code: "SANDBOX_SETUP_TIMEOUT",
        message: "SRT worker 执行超时",
        details: { phase: "setup", durationMs: 75_000, toolCallId: "tool-1" },
      }])
  })

  test("mirrors warnings to the terminal after redaction", () => {
    const directory = mkdtempSync(join(tmpdir(), "codepilotx-desktop-log-"))
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      createDesktopLogger(directory).warn("sidecar.watchdog-degraded", {
        authorization: "Bearer private-token",
        message: "api_key=private-key",
      })
      expect(warning).toHaveBeenCalledTimes(1)
      expect(warning.mock.calls[0]?.[1]).toMatchObject({
        level: "warn",
        event: "sidecar.watchdog-degraded",
        authorization: "[REDACTED]",
        message: "api_key=[REDACTED]",
      })
    } finally {
      warning.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
