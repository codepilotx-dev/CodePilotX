import type {
  McpSanitizedError,
  McpServerDeclaration,
} from "@codepilotx/agent-protocol"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { secretScrubber } from "../security/SecretScrubber"
import type { McpOAuthCoordinator } from "./McpOAuthCoordinator"

export const MAX_MCP_SERVER_INSTRUCTIONS_BYTES = 16 * 1024

export const truncateMcpInstructionsUtf8 = (value: string, maximumBytes: number) => {
  const encoded = Buffer.from(value, "utf8")
  if (encoded.byteLength <= maximumBytes) return value
  const marker = "\n…"
  const markerBytes = Buffer.byteLength(marker, "utf8")
  let end = Math.max(0, maximumBytes - markerBytes)
  const decoder = new TextDecoder("utf-8", { fatal: true })
  while (end > 0) {
    try {
      return `${decoder.decode(encoded.subarray(0, end))}${marker}`
    } catch {
      end -= 1
    }
  }
  return markerBytes <= maximumBytes ? marker : ""
}

export const sanitizeMcpServerInstructions = (value: string | undefined) => {
  const scrubbed = secretScrubber.scrubText(value ?? "").trim()
  if (!scrubbed) return undefined
  return truncateMcpInstructionsUtf8(scrubbed, MAX_MCP_SERVER_INSTRUCTIONS_BYTES)
}

export type McpRawTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number]
export type McpToolResult = Awaited<ReturnType<Client["callTool"]>>
export type McpResource = Awaited<ReturnType<Client["listResources"]>>["resources"][number]
export type McpResourceTemplate = Awaited<ReturnType<Client["listResourceTemplates"]>>["resourceTemplates"][number]
export type McpPrompt = Awaited<ReturnType<Client["listPrompts"]>>["prompts"][number]
export type McpReadResourceResult = Awaited<ReturnType<Client["readResource"]>>

export type McpConnectedClient = {
  client: Client
  tools: McpRawTool[]
  resources: McpResource[]
  resourceTemplates: McpResourceTemplate[]
  prompts: McpPrompt[]
  instructions?: string
  transport: "stdio" | "http" | "sse"
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    requestMeta?: Record<string, unknown>,
  ): Promise<McpToolResult>
  listResources(cursor?: string): ReturnType<Client["listResources"]>
  readResource(uri: string): Promise<McpReadResourceResult>
  close(): Promise<void>
}

export class McpConnectionError extends Error {
  constructor(
    readonly safe: McpSanitizedError,
    readonly needsAuth = false,
  ) {
    super(safe.message)
  }
}

const safeConnectionError = (cause: unknown): McpConnectionError => {
  if (
    cause instanceof UnauthorizedError
    || cause instanceof StreamableHTTPError && (cause.code === 401 || cause.code === 403)
    || cause instanceof SseError && (cause.code === 401 || cause.code === 403)
  ) {
    return new McpConnectionError({
      code: "MCP_AUTH_REQUIRED",
      message: "MCP server 需要认证，请使用 OAuth 或配置环境变量凭据",
      retryable: true,
    }, true)
  }
  const timeout = cause instanceof Error
    && (cause.name === "TimeoutError" || /timed?\s*out|timeout/i.test(cause.message))
  return new McpConnectionError({
    code: timeout ? "MCP_TIMEOUT" : "MCP_CONNECTION_FAILED",
    message: timeout ? "MCP server 连接超时" : "MCP server 连接失败",
    retryable: true,
  })
}

const shouldFallbackToSse = (cause: unknown) => {
  if (cause instanceof StreamableHTTPError) {
    return cause.code === 404
      || cause.code === 405
      || cause.code === 406
      || cause.code === 415
      || cause.code === 501
  }
  return false
}

const isAuthenticationFailure = (cause: unknown) =>
  cause instanceof UnauthorizedError
  || cause instanceof StreamableHTTPError && (cause.code === 401 || cause.code === 403)

const inherited = (references: Record<string, string> | undefined) =>
  Object.fromEntries(
    Object.entries(references ?? {})
      .map(([target, source]) => [target, process.env[source]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )

const requestHeaders = (server: McpServerDeclaration) => {
  if (server.transport.type !== "http") return {}
  const headers: Record<string, string> = {
    ...(server.transport.headers ?? {}),
    ...inherited(server.transport.headerFromEnv),
  }
  const tokenName = server.transport.bearerTokenEnvVar
  const token = tokenName ? process.env[tokenName] : undefined
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

const withoutAuthorization = (headers: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"),
  )

const hasAuthorization = (headers: Record<string, string>) =>
  Object.keys(headers).some((name) => name.toLowerCase() === "authorization")

const listAll = async <T>(
  first: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
) => {
  const items: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const result = await first(cursor)
    items.push(...result.items)
    if (!result.nextCursor) return items
    cursor = result.nextCursor
  }
  return items
}

const page = <T>(items: T[], nextCursor: string | undefined) => ({
  items,
  ...(nextCursor ? { nextCursor } : {}),
})

export class McpClientFactory {
  constructor(private readonly oauth?: McpOAuthCoordinator) {}

  async connect(
    server: McpServerDeclaration,
    onCatalogChanged: () => void,
    onClosed: () => void = () => undefined,
    context: {
      workspaceHash?: string
      onAuthenticationRequired?: () => void
    } = {},
  ): Promise<McpConnectedClient> {
    const startupTimeout = server.startupTimeoutMs ?? 10_000
    try {
      if (server.transport.type === "stdio") {
        const client = this.client()
        try {
          const env = {
            ...getDefaultEnvironment(),
            ...(server.transport.env ?? {}),
            ...inherited(server.transport.envFromHost),
          }
          await client.connect(new StdioClientTransport({
            command: server.transport.command,
            ...(server.transport.args ? { args: [...server.transport.args] } : {}),
            ...(server.transport.cwd ? { cwd: server.transport.cwd } : {}),
            env,
            stderr: "pipe",
          }), { timeout: startupTimeout })
          return await this.ready(client, "stdio", server, onCatalogChanged, onClosed)
        } catch (cause) {
          await client.close().catch(() => undefined)
          throw cause
        }
      }

      const url = new URL(server.transport.url)
      const headers = requestHeaders(server)
      const oauthProvider = server.transport.auth === "none"
        ? undefined
        : await this.oauth?.provider(server, context.workspaceHash)
      const modern = this.client()
      try {
        await modern.connect(new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
          ...(!hasAuthorization(headers) && oauthProvider
            ? { authProvider: oauthProvider }
            : {}),
          reconnectionOptions: {
            initialReconnectionDelay: 500,
            maxReconnectionDelay: 5_000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 2,
          },
        }) as Transport, { timeout: startupTimeout })
        return await this.ready(modern, "http", server, onCatalogChanged, onClosed, context.onAuthenticationRequired)
      } catch (cause) {
        await modern.close().catch(() => undefined)
        if (isAuthenticationFailure(cause) && hasAuthorization(headers) && oauthProvider) {
          const authenticated = this.client()
          try {
            await authenticated.connect(new StreamableHTTPClientTransport(url, {
              authProvider: oauthProvider,
              requestInit: { headers: withoutAuthorization(headers) },
              reconnectionOptions: {
                initialReconnectionDelay: 500,
                maxReconnectionDelay: 5_000,
                reconnectionDelayGrowFactor: 1.5,
                maxRetries: 2,
              },
            }) as Transport, { timeout: startupTimeout })
            return await this.ready(authenticated, "http", server, onCatalogChanged, onClosed, context.onAuthenticationRequired)
          } catch (oauthCause) {
            await authenticated.close().catch(() => undefined)
            throw oauthCause
          }
        }
        if (!shouldFallbackToSse(cause)) throw cause
      }

      const legacy = this.client()
      try {
        await legacy.connect(new SSEClientTransport(url, {
          requestInit: { headers },
          eventSourceInit: {
            fetch: (input, init) => {
              const merged = new Headers(init?.headers)
              for (const [name, value] of Object.entries(headers)) merged.set(name, value)
              return fetch(input, { ...init, headers: merged })
            },
          },
        }), { timeout: startupTimeout })
        return await this.ready(legacy, "sse", server, onCatalogChanged, onClosed, context.onAuthenticationRequired)
      } catch (cause) {
        await legacy.close().catch(() => undefined)
        throw cause
      }
    } catch (cause) {
      throw safeConnectionError(cause)
    }
  }

  private client() {
    return new Client(
      { name: "codepilotx-agent", version: "0.2.0" },
      { capabilities: {} },
    )
  }

  private async ready(
    client: Client,
    transport: McpConnectedClient["transport"],
    server: McpServerDeclaration,
    onCatalogChanged: () => void,
    onClosed: () => void,
    onAuthenticationRequired?: () => void,
  ): Promise<McpConnectedClient> {
    client.onclose = onClosed
    client.setNotificationHandler(ToolListChangedNotificationSchema, onCatalogChanged)
    client.setNotificationHandler(ResourceListChangedNotificationSchema, onCatalogChanged)
    const timeout = server.toolTimeoutMs ?? 60_000
    const capabilities = client.getServerCapabilities()
    const tools = capabilities?.tools
      ? await listAll<McpRawTool>(async (cursor) => {
          const result = await client.listTools(cursor ? { cursor } : undefined, { timeout })
          return page(result.tools, result.nextCursor)
        })
      : []
    const resources = capabilities?.resources
      ? await listAll<McpResource>(async (cursor) => {
          const result = await client.listResources(cursor ? { cursor } : undefined, { timeout })
          return page(result.resources, result.nextCursor)
        }).catch(() => [])
      : []
    const resourceTemplates = capabilities?.resources
      ? await listAll<McpResourceTemplate>(async (cursor) => {
          const result = await client.listResourceTemplates(cursor ? { cursor } : undefined, { timeout })
          return page(result.resourceTemplates, result.nextCursor)
        }).catch(() => [])
      : []
    const prompts = capabilities?.prompts
      ? await listAll<McpPrompt>(async (cursor) => {
          const result = await client.listPrompts(cursor ? { cursor } : undefined, { timeout })
          return page(result.prompts, result.nextCursor)
        }).catch(() => [])
      : []
    const instructions = sanitizeMcpServerInstructions(client.getInstructions())
    return {
      client,
      tools,
      resources,
      resourceTemplates,
      prompts,
      ...(instructions ? { instructions } : {}),
      transport,
      callTool: async (name, args, signal, requestMeta) => {
        try {
          return await client.callTool({
            name,
            arguments: args,
            ...(requestMeta ? { _meta: requestMeta } : {}),
          }, undefined, {
            timeout,
            ...(signal ? { signal } : {}),
          })
        } catch (cause) {
          if (isAuthenticationFailure(cause)) {
            onAuthenticationRequired?.()
            throw safeConnectionError(cause)
          }
          throw cause
        }
      },
      listResources: (cursor) =>
        client.listResources(cursor ? { cursor } : undefined, { timeout }),
      readResource: (uri) => client.readResource({ uri }, { timeout }),
      close: () => client.close(),
    }
  }
}
