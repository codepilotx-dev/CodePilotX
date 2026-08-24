import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  allocateLoopbackPort, configuredRendererPort, createWorktreeInstance,
  parseDevAgentRuntime, parseLegacyDevAgentRuntime, verifyDevAgent,
} from "./dev-runtime"

const validRuntime = {
  schemaVersion: 2 as const, ownerPid: 100, agentPid: 101,
  origin: "http://127.0.0.1:43121",
  authToken: "auth-token-123456789",
  instanceToken: "instance-token-123456789",
}

const legacyRuntime = {
  ...validRuntime,
  schemaVersion: 1 as const,
  rendererDevUrl: "http://127.0.0.1:7788" as const,
}

describe("开发 Agent runtime 描述", () => {
  test("接受不携带 Renderer 地址的 v2 回环 Agent 描述", () => {
    expect(parseDevAgentRuntime(JSON.stringify(validRuntime))).toEqual(validRuntime)
    expect(parseLegacyDevAgentRuntime(JSON.stringify(legacyRuntime))).toEqual(legacyRuntime)
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
    { ...validRuntime, schemaVersion: 1 },
    { ...validRuntime, rendererDevUrl: "http://127.0.0.1:7788" },
    { ...validRuntime, origin: "https://127.0.0.1:43121" },
    { ...validRuntime, origin: "http://localhost:43121" },
    { ...validRuntime, origin: "http://127.0.0.1:43121/path" },
    { ...validRuntime, authToken: "short" },
    { ...validRuntime, unexpected: "secret" },
  ])("拒绝不受支持或扩展的 v2 描述 %#", (runtime) => {
    expect(() => parseDevAgentRuntime(JSON.stringify(runtime))).toThrow("invalid runtime descriptor")
  })
})

describe("worktree Desktop 实例", () => {
  test("规范路径生成稳定且相互隔离的实例目录", () => {
    const first = createWorktreeInstance("C:/project/main", "C:/data")
    const repeated = createWorktreeInstance("C:/project/main/", "C:/data")
    const second = createWorktreeInstance("C:/project/feature", "C:/data")
    expect(first).toEqual(repeated)
    expect(first.id).toHaveLength(64)
    expect(first.id).not.toBe(second.id)
    expect(first.userDataDir).toContain(join("runtime", "dev-desktops", first.id, "user-data"))
    expect(first.logDir).toContain(join("runtime", "dev-desktops", first.id, "logs"))
  })

  test("动态分配回环端口并拒绝占用的显式端口", async () => {
    const port = await allocateLoopbackPort()
    expect(port).toBeGreaterThan(0)
    const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("ok") })
    try {
      await expect(allocateLoopbackPort(port)).rejects.toThrow()
    } finally {
      await server.stop(true)
    }
  })

  test("显式 Renderer 端口使用严格数值范围", () => {
    expect(configuredRendererPort("43122")).toBe(43122)
    expect(configuredRendererPort()).toBeUndefined()
    expect(() => configuredRendererPort("0")).toThrow("invalid configured renderer port")
    expect(() => configuredRendererPort("not-a-port")).toThrow("invalid configured renderer port")
    expect(() => configuredRendererPort("65536")).toThrow("invalid configured renderer port")
  })
})

describe("独立开发启动命令", () => {
  test("Agent 与 Desktop launcher 的进程所有权和 origin 相互独立", async () => {
    const agent = await readFile(new URL("./dev-agent.ts", import.meta.url), "utf8")
    const desktop = await readFile(new URL("./dev-desktop.ts", import.meta.url), "utf8")
    expect(agent).toContain('CODEPILOTX_SIDECAR_INSTANCE_TOKEN: instanceToken')
    expect(agent).not.toContain("CODEPILOTX_RENDERER_DEV_URL")
    expect(desktop).toContain('CODEPILOTX_AGENT_MANAGED: "1"')
    expect(desktop).toContain("CODEPILOTX_RENDERER_DEV_URL: rendererOrigin")
    expect(desktop).toContain("CODEPILOTX_USER_DATA_DIR: instance.userDataDir")
    expect(desktop).not.toContain("/api/shutdown")
    expect(desktop).not.toContain("apps/agent/src/index.ts")
  })

  test("没有 Agent 时 Desktop 只输出安全启动提示", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "codepilotx-missing-runtime-"))
    try {
      const child = Bun.spawn([process.execPath, "run", "scripts/dev-desktop.ts"], {
        cwd: new URL("..", import.meta.url).pathname.slice(1),
        env: { ...process.env, CODEPILOTX_DATA_DIR: dataDir },
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
      expect(stderr).not.toContain(dataDir)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test("健康 v1 Agent 要求重启且不被 Desktop 覆盖", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "codepilotx-legacy-runtime-"))
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (request.headers.get("authorization") !== `Bearer ${legacyRuntime.authToken}`) return new Response(null, { status: 401 })
        return Response.json({ instanceToken: legacyRuntime.instanceToken })
      },
    })
    const descriptor = { ...legacyRuntime, ownerPid: process.pid, agentPid: process.pid, origin: `http://127.0.0.1:${server.port}` }
    try {
      const runtimeDirectory = join(dataDir, "runtime")
      await mkdir(runtimeDirectory, { recursive: true })
      const descriptorPath = join(runtimeDirectory, "dev-agent-v1.json")
      await writeFile(descriptorPath, JSON.stringify(descriptor), "utf8")
      const child = Bun.spawn([process.execPath, "run", "scripts/dev-desktop.ts"], {
        cwd: new URL("..", import.meta.url).pathname.slice(1),
        env: { ...process.env, CODEPILOTX_DATA_DIR: dataDir },
        stdout: "pipe", stderr: "pipe",
      })
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      expect(code).toBe(1)
      expect(stderr.trim()).toBe("检测到旧版开发 Agent。请停止后重新运行：bun run dev:agent")
      expect(await readFile(descriptorPath, "utf8")).toBe(JSON.stringify(descriptor))
    } finally {
      await server.stop(true)
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
