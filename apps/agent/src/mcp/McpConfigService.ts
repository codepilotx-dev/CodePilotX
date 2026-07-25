import type {
  McpScope,
  McpServerDeclaration,
  McpServerListItem,
} from "@codepilotx/agent-protocol"
import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { isAbsolute } from "node:path"
import {
  McpSettingsConflictError,
  McpSettingsRepository,
  type McpSettingsState,
} from "../storage/repositories/mcp-settings-repository"

const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SENSITIVE_NAME = /(?:^|[_-])(authorization|cookie|password|secret|token|api[_-]?key)(?:$|[_-])/i
const STATIC_SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"])

export type McpWorkspaceIdentity = {
  root: string
  hash: string
}

export class McpConfigError extends Error {
  constructor(
    readonly code: "MCP_CONFIG_INVALID" | "MCP_SERVER_NOT_FOUND" | "PATH_DENIED" | "CONFLICT",
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const stableFingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

const workspaceHash = (root: string) =>
  createHash("sha256").update(root.toLowerCase()).digest("hex")

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

export class McpConfigService {
  constructor(private readonly repository: McpSettingsRepository) {}

  async workspace(value?: string): Promise<McpWorkspaceIdentity | null> {
    if (!value) return null
    const root = await realpath(value).catch(() => {
      throw new McpConfigError("PATH_DENIED", "MCP 工作区不存在或无法访问", 403)
    })
    return { root, hash: workspaceHash(root) }
  }

  async list(workspace?: string): Promise<{ servers: McpServerListItem[]; generation: number }> {
    const identity = await this.workspace(workspace)
    return this.listState(this.repository.state(), identity)
  }

  async save(input: {
    workspace?: string
    originalName?: string
    server: McpServerDeclaration
    operationId: string
  }) {
    const identity = await this.workspace(input.workspace)
    const server = this.validate(input.server, identity)
    const originalName = input.originalName?.trim()
    const fingerprint = stableFingerprint({ action: "save", workspace: identity?.hash, originalName, server })
    const result = this.repository.mutate({
      operationId: input.operationId,
      fingerprint,
      apply: (draft) => {
        const collection = this.collection(draft, server.scope, identity, true)
        if (originalName && originalName !== server.name) delete collection[originalName]
        const changed = !same(collection[server.name], server)
        collection[server.name] = server
        return changed || Boolean(originalName && originalName !== server.name)
      },
    })
    return { ...this.listState(result.state, identity), changed: result.changed }
  }

  async remove(input: {
    workspace?: string
    scope: McpScope
    name: string
    operationId: string
  }) {
    const identity = await this.workspace(input.workspace)
    const name = this.validateName(input.name)
    const fingerprint = stableFingerprint({ action: "remove", workspace: identity?.hash, scope: input.scope, name })
    const result = this.repository.mutate({
      operationId: input.operationId,
      fingerprint,
      apply: (draft) => {
        const collection = this.collection(draft, input.scope, identity, false)
        if (!collection[name]) throw new McpConfigError("MCP_SERVER_NOT_FOUND", "MCP server 不存在", 404)
        delete collection[name]
        return true
      },
    })
    return { ...this.listState(result.state, identity), changed: result.changed }
  }

  async setEnabled(input: {
    workspace?: string
    scope: McpScope
    name: string
    enabled: boolean
    operationId: string
  }) {
    const identity = await this.workspace(input.workspace)
    const name = this.validateName(input.name)
    const fingerprint = stableFingerprint({ action: "setEnabled", workspace: identity?.hash, scope: input.scope, name, enabled: input.enabled })
    const result = this.repository.mutate({
      operationId: input.operationId,
      fingerprint,
      apply: (draft) => {
        const collection = this.collection(draft, input.scope, identity, false)
        const server = collection[name]
        if (!server) throw new McpConfigError("MCP_SERVER_NOT_FOUND", "MCP server 不存在", 404)
        if (server.enabled === input.enabled) return false
        collection[name] = { ...server, enabled: input.enabled }
        return true
      },
    })
    return { ...this.listState(result.state, identity), changed: result.changed }
  }

  generation() {
    return this.repository.state().generation
  }

  private listState(state: McpSettingsState, workspace: McpWorkspaceIdentity | null) {
    const user = Object.values(state.user).sort((left, right) => left.name.localeCompare(right.name))
    const local = workspace
      ? Object.values(state.local[workspace.hash] ?? {}).sort((left, right) => left.name.localeCompare(right.name))
      : []
    const localNames = new Set(local.map((server) => server.name))
    return {
      servers: [
        ...user.map((server): McpServerListItem => localNames.has(server.name)
          ? { server, effective: false, shadowedByScope: "local" }
          : { server, effective: true }),
        ...local.map((server): McpServerListItem => ({ server, effective: true })),
      ],
      generation: state.generation,
    }
  }

  private collection(
    state: McpSettingsState,
    scope: McpScope,
    workspace: McpWorkspaceIdentity | null,
    create: boolean,
  ): Record<string, McpServerDeclaration> {
    if (scope === "user") return state.user
    if (!workspace) throw new McpConfigError("MCP_CONFIG_INVALID", "工作区 MCP 配置需要当前工作区", 400)
    if (!state.local[workspace.hash] && create) state.local[workspace.hash] = {}
    return state.local[workspace.hash] ?? {}
  }

  private validate(server: McpServerDeclaration, workspace: McpWorkspaceIdentity | null): McpServerDeclaration {
    const name = this.validateName(server.name)
    if (server.scope === "local" && !workspace) {
      throw new McpConfigError("MCP_CONFIG_INVALID", "工作区 MCP 配置需要当前工作区", 400)
    }
    const startupTimeoutMs = this.timeout(server.startupTimeoutMs, "启动")
    const toolTimeoutMs = this.timeout(server.toolTimeoutMs, "工具调用")
    if (server.transport.type === "stdio") {
      const command = server.transport.command.trim()
      if (!command || command.length > 4_096) throw new McpConfigError("MCP_CONFIG_INVALID", "stdio command 无效", 400)
      if (server.transport.cwd && !isAbsolute(server.transport.cwd)) {
        throw new McpConfigError("MCP_CONFIG_INVALID", "stdio cwd 必须是绝对路径", 400)
      }
      this.validateEnvironment(server.transport.env, "env")
      this.validateReferences(server.transport.envFromHost, "envFromHost")
      return {
        name,
        scope: server.scope,
        enabled: server.enabled,
        ...(server.diagnosticContext ? { diagnosticContext: true } : {}),
        transport: {
          type: "stdio",
          command,
          ...(server.transport.args?.length ? { args: server.transport.args.map((arg) => String(arg)) } : {}),
          ...(server.transport.cwd ? { cwd: server.transport.cwd } : {}),
          ...(server.transport.env && Object.keys(server.transport.env).length ? { env: { ...server.transport.env } } : {}),
          ...(server.transport.envFromHost && Object.keys(server.transport.envFromHost).length ? { envFromHost: { ...server.transport.envFromHost } } : {}),
        },
        ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
        ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
      }
    }

    let url: URL
    try {
      url = new URL(server.transport.url)
    } catch {
      throw new McpConfigError("MCP_CONFIG_INVALID", "HTTP MCP URL 无效", 400)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new McpConfigError("MCP_CONFIG_INVALID", "HTTP MCP URL 只支持 http 或 https", 400)
    }
    if (server.diagnosticContext) {
      throw new McpConfigError("MCP_CONFIG_INVALID", "会话诊断上下文仅支持 stdio MCP server", 400)
    }
    for (const name of Object.keys(server.transport.headers ?? {})) {
      if (STATIC_SECRET_HEADERS.has(name.toLowerCase())) {
        throw new McpConfigError("MCP_CONFIG_INVALID", `${name} 必须通过环境变量引用`, 400)
      }
    }
    this.validateReferences(server.transport.headerFromEnv, "headerFromEnv")
    if (server.transport.bearerTokenEnvVar && !ENV_NAME.test(server.transport.bearerTokenEnvVar)) {
      throw new McpConfigError("MCP_CONFIG_INVALID", "Bearer token 环境变量名无效", 400)
    }
    return {
      name,
      scope: server.scope,
      enabled: server.enabled,
      transport: {
        type: "http",
        url: url.toString(),
        ...(server.transport.headers && Object.keys(server.transport.headers).length ? { headers: { ...server.transport.headers } } : {}),
        ...(server.transport.headerFromEnv && Object.keys(server.transport.headerFromEnv).length ? { headerFromEnv: { ...server.transport.headerFromEnv } } : {}),
        ...(server.transport.bearerTokenEnvVar ? { bearerTokenEnvVar: server.transport.bearerTokenEnvVar } : {}),
      },
      ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
      ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
    }
  }

  private validateName(value: string) {
    const name = value.trim()
    if (!SERVER_NAME.test(name)) {
      throw new McpConfigError("MCP_CONFIG_INVALID", "MCP server 名称必须为 1-64 位字母、数字、点、下划线或连字符", 400)
    }
    return name
  }

  private timeout(value: number | undefined, label: string) {
    if (value === undefined) return undefined
    if (!Number.isInteger(value) || value < 100 || value > 600_000) {
      throw new McpConfigError("MCP_CONFIG_INVALID", `${label}超时必须在 100-600000ms 之间`, 400)
    }
    return value
  }

  private validateEnvironment(value: Record<string, string> | undefined, label: string) {
    for (const [name] of Object.entries(value ?? {})) {
      if (!ENV_NAME.test(name)) throw new McpConfigError("MCP_CONFIG_INVALID", `${label} 环境变量名无效`, 400)
      if (SENSITIVE_NAME.test(name)) {
        throw new McpConfigError("MCP_CONFIG_INVALID", `${name} 看起来包含凭据，请改用 envFromHost`, 400)
      }
    }
  }

  private validateReferences(value: Record<string, string> | undefined, label: string) {
    for (const [target, source] of Object.entries(value ?? {})) {
      if (!target.trim() || !ENV_NAME.test(source)) {
        throw new McpConfigError("MCP_CONFIG_INVALID", `${label} 环境变量引用无效`, 400)
      }
    }
  }
}

export const isMcpSettingsConflict = (cause: unknown) =>
  cause instanceof McpSettingsConflictError
