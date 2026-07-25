import { afterEach, describe, expect, test } from "bun:test"
import type { McpServerDeclaration } from "@codepilotx/agent-protocol"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { McpClientFactory, McpConnectionError } from "../src/mcp/McpClientFactory"
import { McpConnectionManager } from "../src/mcp/McpConnectionManager"
import { McpConfigError, McpConfigService } from "../src/mcp/McpConfigService"
import { McpToolAdapter } from "../src/mcp/McpToolAdapter"
import {
  MCP_DIAGNOSTIC_CONTEXT_KEY,
  McpDiagnosticContextProvider,
} from "../src/mcp/McpDiagnosticContextProvider"
import {
  McpSettingsConflictError,
  McpSettingsRepository,
} from "../src/storage/repositories/mcp-settings-repository"
import { ToolCatalog } from "../src/tool/ToolRegistry"

class MemorySettings {
  readonly values = new Map<string, unknown>()
  getSetting<T>(key: string) {
    return (this.values.get(key) as T | undefined) ?? null
  }
  setSetting(key: string, value: unknown) {
    this.values.set(key, structuredClone(value))
  }
}

const temporaryDirectories: string[] = []
const fixtureProcesses: Bun.Subprocess[] = []

afterEach(async () => {
  for (const process of fixtureProcesses.splice(0)) {
    process.kill()
    await process.exited.catch(() => undefined)
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe("MCP configuration", () => {
  test("keeps user and local declarations while local remains the effective veto", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "codepilotx-mcp-config-"))
    temporaryDirectories.push(workspace)
    const database = new MemorySettings()
    const configs = new McpConfigService(new McpSettingsRepository(database))

    await configs.save({ server: server("fixture", "user", true), operationId: "save-user" })
    await configs.save({
      workspace,
      server: server("fixture", "local", false),
      operationId: "save-local",
    })
    const result = await configs.list(workspace)

    expect(result.servers).toHaveLength(2)
    expect(result.servers[0]).toMatchObject({
      server: { scope: "user", enabled: true },
      effective: false,
      shadowedByScope: "local",
    })
    expect(result.servers[1]).toMatchObject({
      server: { scope: "local", enabled: false },
      effective: true,
    })
    expect(JSON.stringify([...database.values.values()])).not.toContain(workspace)
  })

  test("rejects static credentials and conflicting operation IDs", async () => {
    const configs = new McpConfigService(new McpSettingsRepository(new MemorySettings()))
    await expect(configs.save({
      server: {
        name: "unsafe",
        scope: "user",
        enabled: true,
        transport: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "secret" },
        },
      },
      operationId: "unsafe",
    })).rejects.toBeInstanceOf(McpConfigError)

    await configs.save({ server: server("one", "user", true), operationId: "same-operation" })
    await expect(configs.save({
      server: server("two", "user", true),
      operationId: "same-operation",
    })).rejects.toBeInstanceOf(McpSettingsConflictError)
  })

  test("keeps diagnostic context for stdio and rejects it for HTTP", async () => {
    const configs = new McpConfigService(new McpSettingsRepository(new MemorySettings()))
    await configs.save({
      server: {
        ...server("diagnostic", "user", true),
        diagnosticContext: true,
      },
      operationId: "diagnostic-stdio",
    })
    expect((await configs.list()).servers[0]?.server).toMatchObject({
      name: "diagnostic",
      diagnosticContext: true,
      transport: { type: "stdio" },
    })

    await expect(configs.save({
      server: {
        name: "diagnostic-http",
        scope: "user",
        enabled: true,
        diagnosticContext: true,
        transport: {
          type: "http",
          url: "https://example.com/mcp",
        },
      },
      operationId: "diagnostic-http",
    })).rejects.toMatchObject({
      code: "MCP_CONFIG_INVALID",
    } satisfies Partial<McpConfigError>)
  })
})

describe("MCP transports", () => {
  test("connects to the shared fixture over stdio and exposes tools/resources/prompts", async () => {
    const connection = await new McpClientFactory().connect({
      name: "stdio-fixture",
      scope: "user",
      enabled: true,
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [fixturePath(), "--transport=stdio"],
      },
      startupTimeoutMs: 20_000,
    }, () => undefined)
    try {
      expect(connection.transport).toBe("stdio")
      expect(connection.tools.map((tool) => tool.name)).toContain("echo")
      expect(connection.resources.map((resource) => resource.uri)).toContain("fixture://resources/readme")
      expect(connection.prompts.map((prompt) => prompt.name)).toContain("fixture-greeting")
      const result = await connection.callTool("echo", { text: "hello" })
      expect(result.structuredContent).toEqual({ echoed: "hello" })
      const resources = await connection.listResources()
      expect(resources.resources.map((resource) => resource.uri)).toContain(
        "fixture://resources/readme",
      )
      const resource = await connection.readResource("fixture://resources/readme")
      expect(resource.contents).toMatchObject([
        { uri: "fixture://resources/readme", text: expect.stringContaining("fixture") },
      ])
    } finally {
      await connection.close()
    }
  }, 30_000)

  test("connects over Streamable HTTP, classifies auth, and falls back to legacy SSE", async () => {
    const modern = await startHttpFixture(["--auth-token=fixture-token"])
    const factory = new McpClientFactory()
    await expect(factory.connect({
      name: "auth-required",
      scope: "user",
      enabled: true,
      transport: { type: "http", url: modern.url },
    }, () => undefined)).rejects.toMatchObject({
      needsAuth: true,
    } satisfies Partial<McpConnectionError>)

    process.env.CODEPILOTX_MCP_FIXTURE_TOKEN = "fixture-token"
    const authenticated = await factory.connect({
      name: "http-fixture",
      scope: "user",
      enabled: true,
      transport: {
        type: "http",
        url: modern.url,
        bearerTokenEnvVar: "CODEPILOTX_MCP_FIXTURE_TOKEN",
      },
    }, () => undefined)
    try {
      expect(authenticated.transport).toBe("http")
      expect(authenticated.tools.map((tool) => tool.name)).toContain("echo")
    } finally {
      delete process.env.CODEPILOTX_MCP_FIXTURE_TOKEN
      await authenticated.close()
    }

    const legacy = await startHttpFixture(["--legacy-sse"])
    const fallback = await factory.connect({
      name: "legacy-fixture",
      scope: "user",
      enabled: true,
      transport: { type: "http", url: legacy.url },
    }, () => undefined)
    try {
      expect(fallback.transport).toBe("sse")
      expect(fallback.tools.map((tool) => tool.name)).toContain("echo")
    } finally {
      await fallback.close()
    }
  }, 30_000)
})

describe("MCP turn catalog", () => {
  test("keeps the active turn on its leased generation and retires connections after release", async () => {
    const configs = new McpConfigService(new McpSettingsRepository(new MemorySettings()))
    const baseCatalog = new ToolCatalog([])
    const closed: string[] = []
    let connectionNumber = 0
    const factory = {
      connect: async () => {
        const id = `connection-${++connectionNumber}`
        return {
          client: {},
          transport: "stdio",
          tools: [{
            name: "echo",
            description: "Echo a value",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          }],
          resources: [],
          resourceTemplates: [],
          prompts: [],
          callTool: async () => ({ content: [{ type: "text", text: id }] }),
          listResources: async () => ({ resources: [] }),
          readResource: async () => ({ contents: [] }),
          close: async () => { closed.push(id) },
        }
      },
    }
    const manager = new McpConnectionManager(
      configs,
      baseCatalog,
      factory as unknown as McpClientFactory,
    )
    await configs.save({
      server: server("fixture", "user", true),
      operationId: "initial",
    })

    const firstTurn = await manager.acquire()
    expect(firstTurn.generation).toBe(1)
    expect(firstTurn.catalog.all().map((tool) => tool.sdkName)).toContain(
      "mcp__fixture__echo",
    )
    expect(baseCatalog.all()).toHaveLength(0)

    await configs.save({
      server: {
        ...server("fixture", "user", true),
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixturePath(), "--transport=stdio", "--changed"],
        },
      },
      operationId: "replace",
    })
    const reload = await manager.reload()
    expect(reload.replaced).toEqual(["fixture"])
    expect(closed).toEqual([])

    const secondTurn = await manager.acquire()
    expect(secondTurn.generation).toBeGreaterThan(firstTurn.generation)
    await firstTurn.release()
    expect(closed).toEqual(["connection-1"])
    await secondTurn.release()
    await manager.dispose()
    expect(closed).toEqual(["connection-1", "connection-2"])
  })

  test("injects only bounded and scrubbed host-owned diagnostic metadata", async () => {
    const workspaceRoot = "C:\\private\\workspace"
    const inputs = Array.from({ length: 25 }, (_, index) => ({
      id: `input-${index}`,
      threadId: "thread-1",
      turnId: `turn-${index}`,
      content: index === 24
        ? `inspect ${workspaceRoot}\\secret.txt api_key=super-secret`
        : `user-${index}`,
      strategy: "enqueue",
      mode: "chat",
      model: { providerID: "openai", id: "gpt-5" },
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
      state: "completed",
      createdAt: index,
    }))
    const toolItems = Array.from({ length: 55 }, (_, index) => ({
      id: `tool-${index}`,
      messageID: "message",
      turnId: "turn-1",
      agentId: "agent-1",
      type: "tool",
      callID: `call-${index}`,
      tool: `tool-${index}`,
      title: "tool",
      state: "completed",
      input: { command: "must-not-leak" },
      command: "must-not-leak",
      output: "must-not-leak",
      error: null,
      startedAt: index,
      finishedAt: index + 1,
      durationMs: 1,
      createdAt: index + 100,
    }))
    const provider = new McpDiagnosticContextProvider({
      snapshot: () => ({
        thread: {
          id: "thread-1",
          title: `Thread in ${workspaceRoot}`,
          projectID: null,
          gitBranch: null,
          settings: {
            taskMode: "chat",
            permissionConfig: {
              sandboxMode: "workspace-write",
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
            },
          },
          createdAt: 0,
          updatedAt: 1,
        },
        turns: [],
        agents: [],
        subagents: [],
        inputs,
        messages: [],
        items: [
          {
            id: "reasoning",
            messageID: "message",
            turnId: "turn-1",
            agentId: "agent-1",
            type: "reasoning",
            text: "private reasoning must-not-leak",
            status: "completed",
            createdAt: 99,
          },
          {
            id: "assistant",
            messageID: "message",
            turnId: "turn-1",
            agentId: "agent-1",
            type: "text",
            placement: "result",
            text: "visible assistant",
            status: "completed",
            createdAt: 100,
          },
          ...toolItems,
        ],
        approvals: [],
      } as never),
    })
    let requestMeta: Record<string, unknown> | undefined
    const handle = {
      server: {
        ...server("diagnostic", "user", true),
        diagnosticContext: true,
      },
      fingerprint: "diagnostic",
      state: "connected",
      owners: 1,
      connected: {
        client: {},
        transport: "stdio",
        tools: [{
          name: "echo",
          inputSchema: { type: "object", additionalProperties: true },
        }],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        callTool: async (_name: string, _args: unknown, _signal: unknown, meta: Record<string, unknown>) => {
          requestMeta = meta
          return { content: [] }
        },
        listResources: async () => ({ resources: [] }),
        readResource: async () => ({ contents: [] }),
        close: async () => undefined,
      },
    }
    const definition = new McpToolAdapter(
      1,
      new Map([["diagnostic", handle]]) as never,
      provider,
    ).definitions().find((candidate) => candidate.origin?.kind === "mcp")!

    await definition.execute({}, {
      signal: new AbortController().signal,
      taskMode: "chat",
      profile: "main",
      workspace: { rootPath: workspaceRoot } as never,
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
      model: { providerID: "openai", id: "gpt-5" } as never,
      invocation: {
        threadID: "thread-1",
        turnID: "turn-1",
        agentID: "agent-1",
        toolCallID: "tool-call-1",
      },
    })

    const context = requestMeta?.[MCP_DIAGNOSTIC_CONTEXT_KEY] as {
      entries: unknown[]
      tools: unknown[]
      truncated: boolean
    }
    expect(context.entries).toHaveLength(20)
    expect(context.tools).toHaveLength(50)
    expect(context.truncated).toBe(true)
    const serialized = JSON.stringify(context)
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(64 * 1024)
    expect(serialized).toContain("<workspace>")
    expect(serialized).toContain("<redacted>")
    expect(serialized).not.toContain(workspaceRoot)
    expect(serialized).not.toContain("must-not-leak")
    expect(serialized).not.toContain("private reasoning")
  })

  test("omits diagnostic metadata by default and degrades snapshot failures safely", async () => {
    const metadata: unknown[] = []
    const makeHandle = (diagnosticContext: boolean) => ({
      server: {
        ...server(diagnosticContext ? "enabled" : "disabled", "user", true),
        ...(diagnosticContext ? { diagnosticContext: true } : {}),
      },
      fingerprint: "fixture",
      state: "connected",
      owners: 1,
      connected: {
        client: {},
        transport: "stdio",
        tools: [{ name: "echo", inputSchema: { type: "object" } }],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        callTool: async (_name: string, _args: unknown, _signal: unknown, meta?: unknown) => {
          metadata.push(meta)
          return { content: [] }
        },
        listResources: async () => ({ resources: [] }),
        readResource: async () => ({ contents: [] }),
        close: async () => undefined,
      },
    })
    const provider = new McpDiagnosticContextProvider({ snapshot: () => null })
    const handles = new Map([
      ["disabled", makeHandle(false)],
      ["enabled", makeHandle(true)],
    ])
    const definitions = new McpToolAdapter(1, handles as never, provider).definitions()
    const context = {
      signal: new AbortController().signal,
      taskMode: "chat" as const,
      profile: "main" as const,
      workspace: { rootPath: "C:\\workspace" } as never,
      permissionConfig: {
        sandboxMode: "workspace-write" as const,
        approvalPolicy: "on-request" as const,
        approvalsReviewer: "user" as const,
      },
      model: { providerID: "openai", id: "gpt-5" } as never,
      invocation: {
        threadID: "thread-1",
        turnID: "turn-1",
        agentID: "agent-1",
        toolCallID: "call-1",
      },
    }
    await definitions.find((item) => item.origin?.kind === "mcp" && item.origin.serverName === "disabled")!.execute({}, context)
    await definitions.find((item) => item.origin?.kind === "mcp" && item.origin.serverName === "enabled")!.execute({}, context)
    expect(metadata[0]).toBeUndefined()
    expect(metadata[1]).toEqual({
      [MCP_DIAGNOSTIC_CONTEXT_KEY]: {
        version: 1,
        status: "DIAGNOSTIC_CONTEXT_UNAVAILABLE",
      },
    })
  })

  test("sanitizes tool names, skips invalid schemas, bounds output, and gates resource URIs", async () => {
    const reads: string[] = []
    const handle = {
      server: server("fixture", "user", true),
      fingerprint: "fixture",
      state: "connected",
      owners: 1,
      connected: {
        client: {},
        transport: "stdio",
        tools: [
          {
            name: "echo tool",
            inputSchema: { type: "object", additionalProperties: true },
          },
          {
            name: "echo@tool",
            inputSchema: { type: "object", additionalProperties: true },
          },
          {
            name: "invalid",
            inputSchema: { type: "not-a-json-schema-type" },
          },
        ],
        resources: [{ uri: "fixture://resources/readme", name: "readme" }],
        resourceTemplates: [{
          uriTemplate: "fixture://items/{id}",
          name: "item",
        }],
        prompts: [],
        callTool: async () => ({ content: [] }),
        listResources: async () => ({ resources: [] }),
        readResource: async (uri: string) => {
          reads.push(uri)
          return { contents: [{ uri, text: "ok" }] }
        },
        close: async () => undefined,
      },
    }
    const definitions = new McpToolAdapter(
      7,
      new Map([["fixture", handle]]) as never,
    ).definitions()
    const toolNames = definitions
      .filter((definition) =>
        definition.origin?.kind === "mcp"
        && definition.origin.rawToolName.includes("echo")
      )
      .map((definition) => definition.sdkName)
    expect(toolNames).toHaveLength(2)
    expect(new Set(toolNames).size).toBe(2)
    expect(toolNames.every((name) => name.length <= 64)).toBe(true)
    expect(definitions.some((definition) =>
      definition.origin?.kind === "mcp"
      && definition.origin.rawToolName === "invalid"
    )).toBe(false)
    expect(handle).toMatchObject({
      validToolCount: 2,
      error: { code: "MCP_TOOL_SCHEMA_INVALID" },
    })

    const formatted = definitions.find((definition) =>
      definition.origin?.kind === "mcp"
      && definition.origin.rawToolName === "echo tool"
    )!.formatResult!({ content: [{ type: "text", text: "x".repeat(150_000) }] }, {} as never)
    expect(Buffer.byteLength(formatted.content, "utf8")).toBeLessThanOrEqual(128 * 1024)
    expect(formatted.details).toEqual({ truncated: true })

    const readResource = definitions.find((definition) =>
      definition.sdkName === "mcp_read_resource"
    )!
    await readResource.execute({
      server: "fixture",
      uri: "fixture://items/42",
    }, {} as never)
    expect(reads).toEqual(["fixture://items/42"])
    await expect(readResource.execute({
      server: "fixture",
      uri: "https://example.com/not-announced",
    }, {} as never)).rejects.toMatchObject({ code: "PATH_DENIED" })
  })
})

function server(
  name: string,
  scope: "user" | "local",
  enabled: boolean,
): McpServerDeclaration {
  return {
    name,
    scope,
    enabled,
    transport: {
      type: "stdio",
      command: process.execPath,
      args: [fixturePath(), "--transport=stdio"],
    },
  }
}

function fixturePath() {
  return resolve(import.meta.dir, "fixtures", "mcp-server.ts")
}

async function startHttpFixture(extraArguments: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "codepilotx-mcp-http-"))
  temporaryDirectories.push(directory)
  const portFile = join(directory, "port.txt")
  const child = Bun.spawn([
    process.execPath,
    fixturePath(),
    "--transport=http",
    "--port=0",
    `--port-file=${portFile}`,
    ...extraArguments,
  ], {
    stdout: "ignore",
    stderr: "ignore",
  })
  fixtureProcesses.push(child)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await Bun.file(portFile).exists()) {
      const port = (await Bun.file(portFile).text()).trim()
      return { url: `http://127.0.0.1:${port}/mcp` }
    }
    if (await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(25).then(() => false),
    ])) throw new Error("MCP HTTP fixture exited before reporting its port")
  }
  throw new Error("MCP HTTP fixture did not report its port")
}
