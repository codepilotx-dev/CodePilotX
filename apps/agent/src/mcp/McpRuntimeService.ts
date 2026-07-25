import type {
  McpReloadResultSchema,
  McpScope,
  McpServerDeclaration,
} from "@codepilotx/agent-protocol"
import type { Schema } from "effect"
import { McpConfigError, McpConfigService, isMcpSettingsConflict } from "./McpConfigService"
import { McpConnectionManager } from "./McpConnectionManager"

type McpReloadResult = typeof McpReloadResultSchema.Type

export class McpRuntimeError extends Error {
  constructor(
    readonly code: "MCP_CONFIG_INVALID" | "MCP_SERVER_NOT_FOUND" | "MCP_UNAVAILABLE" | "PATH_DENIED" | "CONFLICT",
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export class McpRuntimeService {
  private readonly reloadOperations = new Map<string, { fingerprint: string; result: McpReloadResult }>()

  constructor(
    private readonly configs: McpConfigService,
    readonly connections: McpConnectionManager,
  ) {}

  list(input: { workspace?: string }) {
    return this.wrap(() => this.configs.list(input.workspace))
  }

  status(input: { workspace?: string }) {
    return this.wrap(() => this.connections.status(input.workspace))
  }

  save(input: {
    workspace?: string
    originalName?: string
    server: McpServerDeclaration
    operationId: string
  }) {
    return this.wrap(() => this.configs.save(input))
  }

  remove(input: {
    workspace?: string
    scope: McpScope
    name: string
    operationId: string
  }) {
    return this.wrap(() => this.configs.remove(input))
  }

  setEnabled(input: {
    workspace?: string
    scope: McpScope
    name: string
    enabled: boolean
    operationId: string
  }) {
    return this.wrap(() => this.configs.setEnabled(input))
  }

  async reload(input: { workspace?: string; operationId: string }) {
    const fingerprint = JSON.stringify({ workspace: input.workspace ?? null })
    const existing = this.reloadOperations.get(input.operationId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new McpRuntimeError("CONFLICT", "operationId 已用于其他 MCP 重载请求", 409)
      }
      return existing.result
    }
    const result = await this.wrap(() => this.connections.reload(input.workspace))
    this.reloadOperations.set(input.operationId, { fingerprint, result })
    if (this.reloadOperations.size > 100) {
      this.reloadOperations.delete(this.reloadOperations.keys().next().value!)
    }
    return result
  }

  private async wrap<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (cause) {
      if (cause instanceof McpRuntimeError) throw cause
      if (cause instanceof McpConfigError) {
        throw new McpRuntimeError(cause.code, cause.message, cause.status)
      }
      if (isMcpSettingsConflict(cause)) {
        throw new McpRuntimeError("CONFLICT", cause instanceof Error ? cause.message : "MCP 设置冲突", 409)
      }
      throw cause
    }
  }
}
