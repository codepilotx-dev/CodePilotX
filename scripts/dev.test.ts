import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("开发编排器 Agent 环境", () => {
  test("Agent 子进程包含桌面托管标记和既有运行配置", async () => {
    const source = await readFile(new URL("./dev.ts", import.meta.url), "utf8")
    const start = source.indexOf("const agent = spawn(")
    const end = source.indexOf("forwardLines(agent", start)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const agentSpawnBlock = source.slice(start, end)
    expect(agentSpawnBlock).toContain('CODEPILOTX_DESKTOP_MANAGED: "1"')
    expect(agentSpawnBlock).toContain("CODEPILOTX_AUTH_TOKEN: authToken")
    expect(agentSpawnBlock).toContain("CODEPILOTX_DATA_DIR: agentDataDir")
    expect(agentSpawnBlock).toContain("CODEPILOTX_LOG_DIR: agentLogDir")
  })
})
