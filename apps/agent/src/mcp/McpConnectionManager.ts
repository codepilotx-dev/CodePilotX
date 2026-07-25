import type {
  McpReloadResultSchema,
  McpRuntimeServerStatus,
  McpSanitizedError,
  McpServerDeclaration,
} from "@codepilotx/agent-protocol"
import type { Schema } from "effect"
import { createHash } from "node:crypto"
import { TurnToolCatalog, type ToolCatalog, type ToolDefinition } from "../tool/ToolRegistry"
import { McpClientFactory, McpConnectionError, type McpConnectedClient } from "./McpClientFactory"
import { McpConfigService } from "./McpConfigService"
import { McpToolAdapter } from "./McpToolAdapter"
import type { McpDiagnosticContextProvider } from "./McpDiagnosticContextProvider"

type McpReloadResult = typeof McpReloadResultSchema.Type

type ConnectionHandle = {
  server: McpServerDeclaration
  fingerprint: string
  state: McpRuntimeServerStatus["state"]
  error?: McpSanitizedError
  connected?: McpConnectedClient
  validToolCount?: number
  owners: number
  catalogDirty?: boolean
  closing?: boolean
}

type RuntimeGeneration = {
  id: number
  configGeneration: number
  handles: Map<string, ConnectionHandle>
  definitions: ToolDefinition[]
  leases: number
  retired: boolean
}

type WorkspaceRuntime = {
  key: string
  workspace?: string
  current?: RuntimeGeneration
  reconcile: Promise<McpReloadResult> | undefined
}

export type McpTurnLease = {
  generation: number
  definitions: readonly ToolDefinition[]
  catalog: ToolCatalog
  release(): Promise<void>
}

const fingerprint = (server: McpServerDeclaration) =>
  createHash("sha256").update(JSON.stringify(server)).digest("hex")

const statusFor = (handle: ConnectionHandle): McpRuntimeServerStatus => ({
  name: handle.server.name,
  scope: handle.server.scope,
  type: handle.server.transport.type,
  state: handle.state,
  ...(handle.error ? { error: handle.error } : {}),
  toolCount: handle.validToolCount ?? handle.connected?.tools.length ?? 0,
  resourceCount: (handle.connected?.resources.length ?? 0) + (handle.connected?.resourceTemplates.length ?? 0),
  promptCount: handle.connected?.prompts.length ?? 0,
})

export class McpConnectionManager {
  private readonly runtimes = new Map<string, WorkspaceRuntime>()
  private nextGeneration = 1

  constructor(
    private readonly configs: McpConfigService,
    private readonly baseCatalog: ToolCatalog,
    private readonly factory = new McpClientFactory(),
    private readonly updated?: (generation: number) => void | Promise<void>,
    private readonly diagnosticContext?: McpDiagnosticContextProvider,
  ) {}

  async status(workspace?: string) {
    const runtime = await this.runtime(workspace)
    await this.ensure(runtime, false)
    const config = await this.configs.list(workspace)
    const current = runtime.current
    const statuses: McpRuntimeServerStatus[] = config.servers.map((item) => {
      if (!item.effective) {
        return {
          name: item.server.name,
          scope: item.server.scope,
          type: item.server.transport.type,
          state: "shadowed",
          toolCount: 0,
          resourceCount: 0,
          promptCount: 0,
        }
      }
      if (!item.server.enabled) {
        return {
          name: item.server.name,
          scope: item.server.scope,
          type: item.server.transport.type,
          state: "disabled",
          toolCount: 0,
          resourceCount: 0,
          promptCount: 0,
        }
      }
      const handle = current?.handles.get(item.server.name)
      return handle ? statusFor(handle) : {
        name: item.server.name,
        scope: item.server.scope,
        type: item.server.transport.type,
        state: "starting",
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
      }
    })
    return {
      servers: statuses,
      totalTools: statuses.reduce((total, server) => total + server.toolCount, 0),
      totalResources: statuses.reduce((total, server) => total + server.resourceCount, 0),
      totalPrompts: statuses.reduce((total, server) => total + server.promptCount, 0),
      generation: current?.id ?? config.generation,
    }
  }

  async reload(workspace?: string): Promise<McpReloadResult> {
    const runtime = await this.runtime(workspace)
    return this.ensure(runtime, true)
  }

  async acquire(workspace?: string): Promise<McpTurnLease> {
    const runtime = await this.runtime(workspace)
    await this.ensure(runtime, false)
    const generation = runtime.current!
    generation.leases += 1
    let released = false
    return {
      generation: generation.id,
      definitions: generation.definitions,
      catalog: new TurnToolCatalog(this.baseCatalog, generation.definitions),
      release: async () => {
        if (released) return
        released = true
        generation.leases = Math.max(0, generation.leases - 1)
        await this.disposeRetired(generation)
      },
    }
  }

  async dispose() {
    const generations = [...this.runtimes.values()]
      .map((runtime) => runtime.current)
      .filter((generation): generation is RuntimeGeneration => Boolean(generation))
    this.runtimes.clear()
    await Promise.all(generations.map(async (generation) => {
      generation.retired = true
      generation.leases = 0
      await this.disposeRetired(generation)
    }))
  }

  private async runtime(workspace?: string) {
    const identity = await this.configs.workspace(workspace)
    const key = identity?.hash ?? "global"
    const existing = this.runtimes.get(key)
    if (existing) return existing
    const runtime: WorkspaceRuntime = {
      key,
      reconcile: undefined,
      ...(identity ? { workspace: identity.root } : {}),
    }
    this.runtimes.set(key, runtime)
    return runtime
  }

  private async ensure(runtime: WorkspaceRuntime, force: boolean): Promise<McpReloadResult> {
    const config = await this.configs.list(runtime.workspace)
    if (!force && runtime.current?.configGeneration === config.generation) {
      return {
        generation: runtime.current.id,
        added: [],
        replaced: [],
        removed: [],
        unchanged: [...runtime.current.handles.keys()],
        failed: [],
      }
    }
    if (runtime.reconcile) return runtime.reconcile
    runtime.reconcile = this.reconcile(runtime, config.generation, config.servers, force)
      .finally(() => { runtime.reconcile = undefined })
    return runtime.reconcile
  }

  private async reconcile(
    runtime: WorkspaceRuntime,
    configGeneration: number,
    declarations: Awaited<ReturnType<McpConfigService["list"]>>["servers"],
    force: boolean,
  ): Promise<McpReloadResult> {
    const previous = runtime.current
    const desired = declarations
      .filter((item) => item.effective && item.server.enabled)
      .map((item) => item.server)
    const handles = new Map<string, ConnectionHandle>()
    const added: string[] = []
    const replaced: string[] = []
    const unchanged: string[] = []
    const failed: Array<{ name: string; error: McpSanitizedError }> = []

    await Promise.all(desired.map(async (server) => {
      const prior = previous?.handles.get(server.name)
      const nextFingerprint = fingerprint(server)
      if (
        prior
        && prior.fingerprint === nextFingerprint
        && prior.catalogDirty !== true
        && (!force || prior.state === "connected")
      ) {
        prior.owners += 1
        handles.set(server.name, prior)
        unchanged.push(server.name)
        return
      }

      const handle: ConnectionHandle = {
        server,
        fingerprint: nextFingerprint,
        state: "starting",
        owners: 1,
      }
      handles.set(server.name, handle)
      if (prior) replaced.push(server.name)
      else added.push(server.name)
      try {
        handle.connected = await this.factory.connect(
          server,
          () => { void this.catalogChanged(runtime, server.name) },
          () => { void this.connectionClosed(runtime, server.name, handle) },
        )
        handle.state = "connected"
      } catch (cause) {
        const error = cause instanceof McpConnectionError
          ? cause
          : new McpConnectionError({
              code: "MCP_CONNECTION_FAILED",
              message: "MCP server 连接失败",
              retryable: true,
            })
        handle.state = error.needsAuth ? "needs_auth" : "failed"
        handle.error = error.safe
        failed.push({ name: server.name, error: error.safe })
      }
    }))

    const removed = previous
      ? [...previous.handles.keys()].filter((name) => !handles.has(name))
      : []
    const generation: RuntimeGeneration = {
      id: this.nextGeneration++,
      configGeneration,
      handles,
      definitions: [],
      leases: 0,
      retired: false,
    }
    generation.definitions = new McpToolAdapter(
      generation.id,
      handles,
      this.diagnosticContext,
    ).definitions()
    runtime.current = generation
    if (previous) {
      previous.retired = true
      await this.disposeRetired(previous)
    }
    await this.updated?.(generation.id)
    return {
      generation: generation.id,
      added: added.sort(),
      replaced: replaced.sort(),
      removed: removed.sort(),
      unchanged: unchanged.sort(),
      failed: failed.sort((left, right) => left.name.localeCompare(right.name)),
    }
  }

  private async catalogChanged(runtime: WorkspaceRuntime, serverName: string) {
    const current = runtime.current
    const handle = current?.handles.get(serverName)
    if (!current || !handle?.connected) return
    handle.catalogDirty = true
    current.configGeneration = -1
    await this.ensure(runtime, true)
  }

  private async connectionClosed(
    runtime: WorkspaceRuntime,
    serverName: string,
    handle: ConnectionHandle,
  ) {
    const current = runtime.current
    if (handle.closing || current?.handles.get(serverName) !== handle) return
    delete handle.connected
    handle.state = "failed"
    handle.error = {
      code: "MCP_CONNECTION_CLOSED",
      message: "MCP server 连接已中断",
      retryable: true,
    }
    handle.catalogDirty = true
    current.configGeneration = -1
    await this.updated?.(current.id)
  }

  private async disposeRetired(generation: RuntimeGeneration) {
    if (!generation.retired || generation.leases > 0) return
    const closing: Promise<void>[] = []
    for (const handle of generation.handles.values()) {
      handle.owners = Math.max(0, handle.owners - 1)
      if (handle.owners === 0 && handle.connected) {
        handle.closing = true
        closing.push(handle.connected.close().catch(() => undefined))
      }
    }
      generation.handles.clear()
    await Promise.all(closing)
  }
}

export type McpConnectionHandle = ConnectionHandle
