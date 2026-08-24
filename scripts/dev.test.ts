import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { parseDevAgentRuntime, rendererDevURL, verifyDevAgent } from "./dev-runtime"

const validRuntime = {
  schemaVersion: 1 as const, ownerPid: 100, agentPid: 101,
  origin: "http://127.0.0.1:43121",
  authToken: "auth-token-123456789",
  instanceToken: "instance-token-123456789",
  rendererDevUrl: rendererDevURL,
}

describe("开发 Agent runtime 描述", () => {
  test("接受版本化的回环 Agent 描述", () => {
    expect(parseDevAgentRuntime(JSON.stringify(validRuntime))).toEqual(validRuntime)
  })

  test("健康检查同时校验 bearer token 和实例标识", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (request.headers.get("authorization") !== `Bearer ${validRuntime.authToken}`) return new Response(null, { status: 401 })
        return Response.json({ ok: true, instanceToken: validRuntime.instanceToken })
      },
    })
    try {
      const runtime = { ...validRuntime, origin: `http://127.0.0.1:${server.port}` }
      expect(await verifyDevAgent(runtime)).toBe(true)
      expect(await verifyDevAgent({ ...runtime, instanceToken: "another-instance-token" })).toBe(false)
    } finally {
      await server.stop(true)
    }
  })

  test.each([
    { ...validRuntime, schemaVersion: 2 },
    { ...validRuntime, origin: "https://127.0.0.1:43121" },
    { ...validRuntime, origin: "http://localhost:43121" },
    { ...validRuntime, origin: "http://127.0.0.1:43121/path" },
    { ...validRuntime, authToken: "short" },
    { ...validRuntime, rendererDevUrl: "http://127.0.0.1:9999" },
    { ...validRuntime, unexpected: "secret" },
  ])("拒绝不受支持或扩展的描述 %#", (runtime) => {
    expect(() => parseDevAgentRuntime(JSON.stringify(runtime))).toThrow("invalid runtime descriptor")
  })
})

describe("独立开发启动命令", () => {
  test("Agent 与 Desktop launcher 的进程所有权相互独立", async () => {
    const agent = await readFile(new URL("./dev-agent.ts", import.meta.url), "utf8")
    const desktop = await readFile(new URL("./dev-desktop.ts", import.meta.url), "utf8")
    expect(agent).toContain('CODEPILOTX_SIDECAR_INSTANCE_TOKEN: instanceToken')
    expect(agent).toContain('CODEPILOTX_DESKTOP_MANAGED: "1"')
    expect(desktop).toContain('CODEPILOTX_AGENT_MANAGED: "1"')
    expect(desktop).not.toContain("/api/shutdown")
    expect(desktop).not.toContain("apps/agent/src/index.ts")
  })

  test("没有 Agent 时 Desktop 只输出安全启动提示", async () => {
    const child = Bun.spawn([process.execPath, "run", "scripts/dev-desktop.ts"], {
      cwd: new URL("..", import.meta.url).pathname.slice(1),
      env: { ...process.env, CODEPILOTX_DATA_DIR: new URL(`./fixtures/missing-runtime-${crypto.randomUUID()}`, import.meta.url).pathname.slice(1) },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr.trim()).toBe("未发现可用的开发 Agent。请先在另一个终端运行：bun run dev:agent")
  })
})
