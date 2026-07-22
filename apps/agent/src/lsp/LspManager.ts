import { existsSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { z } from "zod"
import { AgentError } from "../domain"
import type { ToolDefinition } from "../tool/ToolRegistry"
import { environmentWithToolingPath, resolveToolingEnvironment, type ToolingEnvironmentResolver } from "../tool/ToolingRuntime"
import type { ManagedToolID } from "../tool/ToolingManager"

export type LspServerConfig = {
  id: string
  languages: readonly string[]
  extensions: readonly string[]
  command: readonly string[]
  runtimeDependencies?: readonly ManagedToolID[]
  initializationOptions?: unknown
}

export interface LspClient {
  initialize(): Promise<void>
  notify(method: string, params: unknown): void
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>
  close(): Promise<void>
}

type JsonRpcResponse = { jsonrpc: "2.0"; id: number; result?: unknown; error?: { code: number; message: string; data?: unknown } }
type PendingRequest = { resolve(value: unknown): void; reject(cause: unknown): void; cleanup(): void }
type LspProcess = {
  stdin: { write(data: Uint8Array): number | Promise<number> }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill(): void
}

class ProcessLspClient implements LspClient {
  private nextID = 1
  private buffer = new Uint8Array(0)
  private readonly pending = new Map<number, PendingRequest>()
  private closed = false
  private readonly process: LspProcess

  constructor(private readonly config: LspServerConfig, private readonly rootPath: string, env?: NodeJS.ProcessEnv) {
    try {
      this.process = Bun.spawn([...config.command], { cwd: rootPath, ...(env ? { env } : {}), stdin: "pipe", stdout: "pipe", stderr: "pipe" }) as unknown as LspProcess
    } catch (cause) {
      throw new AgentError("LSP_SERVER_UNAVAILABLE", `无法启动 LSP Server ${config.id}`, 503, cause)
    }
    void this.readStdout()
    void this.drainStderr()
    void this.process.exited.then((code) => this.failAll(new AgentError("LSP_SERVER_EXITED", `LSP Server ${config.id} 已退出 (${code})`, 502)))
  }

  async initialize() {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.rootPath).toString(),
      capabilities: {
        textDocument: { definition: { linkSupport: true }, references: {}, hover: {}, documentSymbol: {}, implementation: { linkSupport: true }, callHierarchy: {} },
        workspace: { workspaceFolders: true, symbol: {} },
      },
      workspaceFolders: [{ uri: pathToFileURL(this.rootPath).toString(), name: this.rootPath.split(/[\\/]/).at(-1) ?? "workspace" }],
      initializationOptions: this.config.initializationOptions ?? null,
    })
    this.notify("initialized", {})
  }

  notify(method: string, params: unknown) { this.write({ jsonrpc: "2.0", method, params }) }

  request(method: string, params: unknown, signal?: AbortSignal) {
    if (this.closed) return Promise.reject(new AgentError("LSP_SERVER_CLOSED", `LSP Server ${this.config.id} 不可用`, 503))
    if (signal?.aborted) return Promise.reject(new AgentError("RUN_ABORTED", "任务已停止", 499))
    const id = this.nextID++
    let onAbort: (() => void) | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const promise = new Promise<unknown>((resolveRequest, reject) => {
      onAbort = () => {
        this.pending.get(id)?.cleanup(); this.pending.delete(id)
        this.notify("$/cancelRequest", { id }); reject(new AgentError("RUN_ABORTED", "任务已停止", 499))
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      timeout = setTimeout(() => {
        this.pending.get(id)?.cleanup(); this.pending.delete(id)
        this.notify("$/cancelRequest", { id }); reject(new AgentError("LSP_REQUEST_TIMEOUT", `LSP 请求 ${method} 超时`, 504))
      }, 15_000)
      this.pending.set(id, { resolve: resolveRequest, reject, cleanup: () => {
        signal?.removeEventListener("abort", onAbort!)
        if (timeout) clearTimeout(timeout)
      } })
    })
    this.write({ jsonrpc: "2.0", id, method, params })
    return promise
  }

  async close() {
    if (this.closed) return
    try { await this.request("shutdown", null) } catch { /* server may already be gone */ }
    this.notify("exit", null); this.closed = true; this.process.kill()
  }

  private write(message: unknown) {
    const body = new TextEncoder().encode(JSON.stringify(message))
    const header = new TextEncoder().encode(`Content-Length: ${body.byteLength}\r\n\r\n`)
    const packet = new Uint8Array(header.byteLength + body.byteLength)
    packet.set(header); packet.set(body, header.byteLength)
    void Promise.resolve(this.process.stdin.write(packet)).catch((cause: unknown) => this.failAll(cause))
  }

  private async readStdout() {
    const reader = this.process.stdout.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        const joined = new Uint8Array(this.buffer.byteLength + value.byteLength)
        joined.set(this.buffer); joined.set(value, this.buffer.byteLength); this.buffer = joined; this.parseMessages()
      }
    } catch (cause) { this.failAll(cause) }
  }

  private parseMessages() {
    const marker = new TextEncoder().encode("\r\n\r\n")
    while (true) {
      let headerEnd = -1
      outer: for (let i = 0; i <= this.buffer.byteLength - marker.byteLength; i += 1) {
        for (let j = 0; j < marker.byteLength; j += 1) if (this.buffer[i + j] !== marker[j]) continue outer
        headerEnd = i; break
      }
      if (headerEnd < 0) return
      const header = new TextDecoder().decode(this.buffer.slice(0, headerEnd))
      const length = Number(header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i)?.[1])
      if (!Number.isSafeInteger(length) || length < 0) { this.failAll(new Error("Invalid LSP Content-Length")); return }
      const bodyStart = headerEnd + marker.byteLength
      if (this.buffer.byteLength < bodyStart + length) return
      const message = JSON.parse(new TextDecoder().decode(this.buffer.slice(bodyStart, bodyStart + length))) as Partial<JsonRpcResponse>
      this.buffer = this.buffer.slice(bodyStart + length)
      if (typeof message.id !== "number") continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id); pending.cleanup()
      if (message.error) pending.reject(new AgentError("LSP_REQUEST_FAILED", message.error.message, 502))
      else pending.resolve(message.result)
    }
  }

  private async drainStderr() {
    const reader = this.process.stderr.getReader()
    while (!(await reader.read()).done) { /* source-bearing server output is never logged */ }
  }

  private failAll(cause: unknown) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(cause) }
    this.pending.clear()
  }
}

const typeScriptLanguageServerCommand = () => {
  const explicit = process.env.CODEPILOTX_TYPESCRIPT_LANGUAGE_SERVER?.trim()
  if (explicit) return explicit
  return "typescript-language-server"
}

const TYPESCRIPT_LANGUAGE_SERVER_COMMAND = typeScriptLanguageServerCommand()

export const TYPESCRIPT_LSP_CONFIG: LspServerConfig = {
  id: "typescript",
  languages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
  command: [TYPESCRIPT_LANGUAGE_SERVER_COMMAND, "--stdio"],
  runtimeDependencies: /(?:^|[\\/])typescript-language-server(?:\.cmd)?$/i.test(TYPESCRIPT_LANGUAGE_SERVER_COMMAND)
    || /\.(?:[cm]?js|cmd)$/i.test(TYPESCRIPT_LANGUAGE_SERVER_COMMAND)
    ? ["nodejs"]
    : [],
}

const position = z.object({ filePath: z.string().min(1), line: z.number().int().min(1), character: z.number().int().min(1) })
export const lspInputSchema = z.discriminatedUnion("operation", [
  position.extend({ operation: z.literal("goToDefinition") }).strict(),
  position.extend({ operation: z.literal("findReferences") }).strict(),
  position.extend({ operation: z.literal("hover") }).strict(),
  z.object({ operation: z.literal("documentSymbol"), filePath: z.string().min(1) }).strict(),
  z.object({ operation: z.literal("workspaceSymbol"), query: z.string().min(1) }).strict(),
  position.extend({ operation: z.literal("goToImplementation") }).strict(),
  position.extend({ operation: z.literal("prepareCallHierarchy") }).strict(),
  position.extend({ operation: z.literal("incomingCalls") }).strict(),
  position.extend({ operation: z.literal("outgoingCalls") }).strict(),
])
export type LspToolInput = z.infer<typeof lspInputSchema>

type OpenDocument = { version: number; content: string }
type ManagerOptions = {
  createClient?: (config: LspServerConfig, rootPath: string, env?: NodeJS.ProcessEnv) => LspClient
  resolveEnvironment?: ToolingEnvironmentResolver
}

const languageId = (path: string, config: LspServerConfig) => ({
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "typescriptreact",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascriptreact",
} as Record<string, string>)[path.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ""] ?? config.languages[0]!

const workspaceFilePath = async (rootPath: string, uri: string) => {
  let target: string
  try { target = fileURLToPath(uri) } catch { throw new AgentError("LSP_URI_INVALID", "LSP 返回了无效文件 URI", 502) }
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(rootPath), realpath(target).catch(() => null)])
  if (!canonicalTarget) throw new AgentError("LSP_URI_OUTSIDE_WORKSPACE", "LSP 返回的文件不在当前工作区", 403)
  const scoped = relative(canonicalRoot, canonicalTarget)
  if (!scoped || (!scoped.startsWith("..") && !isAbsolute(scoped))) return scoped || "."
  throw new AgentError("LSP_URI_OUTSIDE_WORKSPACE", "LSP 返回的文件不在当前工作区", 403)
}

const workspaceInputPath = async (rootPath: string, filePath: string) => {
  const candidate = resolve(rootPath, filePath)
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(rootPath), realpath(candidate).catch(() => null)])
  if (!canonicalTarget) throw new AgentError("LSP_FILE_NOT_FOUND", `LSP 文件不存在：${filePath}`, 404)
  const scoped = relative(canonicalRoot, canonicalTarget)
  if (scoped.startsWith("..") || isAbsolute(scoped)) throw new AgentError("LSP_FILE_OUTSIDE_WORKSPACE", "LSP 文件不在当前工作区", 403)
  return canonicalTarget
}

const normalizeLspResult = async (rootPath: string, value: unknown): Promise<unknown> => {
  if (Array.isArray(value)) return Promise.all(value.map((item) => normalizeLspResult(rootPath, item)))
  if (!value || typeof value !== "object") return value
  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "uri" || key.endsWith("Uri")) && typeof nested === "string") {
      const pathKey = key === "uri" ? "filePath" : `${key.slice(0, -3)}FilePath`
      output[pathKey] = await workspaceFilePath(rootPath, nested)
    } else output[key] = await normalizeLspResult(rootPath, nested)
  }
  return output
}

const validateLspUris = async (rootPath: string, value: unknown): Promise<void> => {
  if (Array.isArray(value)) { await Promise.all(value.map((item) => validateLspUris(rootPath, item))); return }
  if (!value || typeof value !== "object") return
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "uri" || key.endsWith("Uri")) && typeof nested === "string") await workspaceFilePath(rootPath, nested)
    else await validateLspUris(rootPath, nested)
  }
}

export class LspManager {
  private readonly configs: LspServerConfig[]
  private readonly createClient: NonNullable<ManagerOptions["createClient"]>
  private readonly resolveEnvironment: ToolingEnvironmentResolver
  private readonly connections = new Map<string, Promise<LspClient>>()
  private readonly documents = new Map<string, OpenDocument>()
  constructor(configs: LspServerConfig[] = [TYPESCRIPT_LSP_CONFIG], options: ManagerOptions = {}) {
    this.configs = configs
    this.createClient = options.createClient ?? ((config, rootPath, env) => new ProcessLspClient(config, rootPath, env))
    this.resolveEnvironment = options.resolveEnvironment ?? resolveToolingEnvironment
  }

  private configFor(path: string) {
    const lower = path.toLowerCase()
    const config = this.configs.find((candidate) => candidate.extensions.some((extension) => lower.endsWith(extension)))
    if (!config) throw new AgentError("LSP_LANGUAGE_UNSUPPORTED", `没有适用于 ${path} 的 LSP Server`, 400)
    return config
  }

  private connection(config: LspServerConfig, rootPath: string) {
    const key = `${config.id}\0${rootPath}`
    let connection = this.connections.get(key)
    if (!connection) {
      connection = Promise.resolve().then(async () => {
        const required = config.runtimeDependencies ?? []
        const runtime = required.length > 0
          ? await this.resolveEnvironment(required)
          : { pathEntries: [] as readonly string[], resolutions: new Map() }
        for (const id of config.runtimeDependencies ?? []) {
          const resolution = runtime.resolutions.get(id)
          if (!resolution?.available) throw new AgentError("LSP_RUNTIME_UNAVAILABLE", resolution?.reason ?? `${id} 运行环境不可用`, 503, { toolingID: id })
        }
        let resolvedConfig = config
        if (config.id === "typescript" && config.command[0] === "typescript-language-server") {
          const workspaceCommand = join(rootPath, "node_modules", ".bin", process.platform === "win32" ? "typescript-language-server.cmd" : "typescript-language-server")
          if (existsSync(workspaceCommand)) resolvedConfig = { ...config, command: [workspaceCommand, ...config.command.slice(1)] }
        }
        const created = this.createClient(resolvedConfig, rootPath, environmentWithToolingPath(runtime.pathEntries))
        await created.initialize()
        return created
      })
      this.connections.set(key, connection); void connection.catch(() => this.connections.delete(key))
    }
    return connection
  }

  private async syncDocument(rootPath: string, filePath: string, content: string) {
    const config = this.configFor(filePath)
    const absolutePath = await workspaceInputPath(rootPath, filePath)
    const client = await this.connection(config, rootPath)
    const uri = pathToFileURL(absolutePath).toString()
    const key = `${rootPath}\0${absolutePath}`
    const current = this.documents.get(key)
    if (!current) {
      this.documents.set(key, { version: 1, content })
      client.notify("textDocument/didOpen", { textDocument: { uri, languageId: languageId(filePath, config), version: 1, text: content } })
    } else if (current.content !== content) {
      const version = current.version + 1
      this.documents.set(key, { version, content })
      client.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text: content }] })
    }
    return { client, uri }
  }

  async didChange(input: { rootPath: string; filePath: string; content: string }) { await this.syncDocument(input.rootPath, input.filePath, input.content) }

  async didSave(input: { rootPath: string; filePath: string; content: string }) {
    const { client, uri } = await this.syncDocument(input.rootPath, input.filePath, input.content)
    client.notify("textDocument/didSave", { textDocument: { uri }, text: input.content })
  }

  async execute(input: LspToolInput, context: { rootPath: string; read(filePath: string): Promise<string>; signal?: AbortSignal }) {
    if (context.signal?.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    if (input.operation === "workspaceSymbol") {
      const config = this.configs[0]
      if (!config) throw new AgentError("LSP_LANGUAGE_UNSUPPORTED", "没有可用的 LSP Server", 400)
      const client = await this.connection(config, context.rootPath)
      return normalizeLspResult(context.rootPath, await client.request("workspace/symbol", { query: input.query }, context.signal))
    }
    const content = await context.read(input.filePath)
    const { client, uri } = await this.syncDocument(context.rootPath, input.filePath, content)
    if (input.operation === "documentSymbol") return normalizeLspResult(context.rootPath, await client.request("textDocument/documentSymbol", { textDocument: { uri } }, context.signal))
    const positionParams = { textDocument: { uri }, position: { line: input.line - 1, character: input.character - 1 } }
    const methods = {
      goToDefinition: "textDocument/definition", findReferences: "textDocument/references", hover: "textDocument/hover",
      goToImplementation: "textDocument/implementation", prepareCallHierarchy: "textDocument/prepareCallHierarchy",
    } as const
    if (input.operation in methods) {
      const method = methods[input.operation as keyof typeof methods]
      const params = input.operation === "findReferences" ? { ...positionParams, context: { includeDeclaration: true } } : positionParams
      return normalizeLspResult(context.rootPath, await client.request(method, params, context.signal))
    }
    const items = await client.request("textDocument/prepareCallHierarchy", positionParams, context.signal)
    await validateLspUris(context.rootPath, items)
    const prepared = Array.isArray(items) ? items : items == null ? [] : [items]
    const method = input.operation === "incomingCalls" ? "callHierarchy/incomingCalls" : "callHierarchy/outgoingCalls"
    const responses = await Promise.all(prepared.map((item) => client.request(method, { item }, context.signal)))
    return normalizeLspResult(context.rootPath, responses.flatMap((response) => Array.isArray(response) ? response : response == null ? [] : [response]))
  }

  async close() { await Promise.allSettled([...this.connections.values()].map(async (connection) => (await connection).close())); this.connections.clear(); this.documents.clear() }
}

export const createLspTool = (manager: LspManager): ToolDefinition<LspToolInput, { result: unknown }> => ({
  sdkName: "LSP", name: "lsp", description: "通过语言服务器查询定义、引用、悬停、符号、实现与调用层级。输入位置使用 1-based 行列。",
  schema: lspInputSchema,
  inputSchema: {
    type: "object",
    oneOf: [
      ...["goToDefinition", "findReferences", "hover", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"].map((operation) => ({
        type: "object", properties: { operation: { const: operation }, filePath: { type: "string" }, line: { type: "integer", minimum: 1 }, character: { type: "integer", minimum: 1 } },
        required: ["operation", "filePath", "line", "character"], additionalProperties: false,
      })),
      { type: "object", properties: { operation: { const: "documentSymbol" }, filePath: { type: "string" } }, required: ["operation", "filePath"], additionalProperties: false },
      { type: "object", properties: { operation: { const: "workspaceSymbol" }, query: { type: "string" } }, required: ["operation", "query"], additionalProperties: false },
    ],
  },
  capabilities: { filesystem: "read", network: "none", process: true, externalState: false, userInteraction: false },
  allowedModes: ["chat", "plan"], allowedProfiles: ["main", "default", "explorer", "worker"], approvalStrategy: "policy",
  visibility: "deferred", executionMode: "parallel",
  execute: async (input, context) => ({ result: await manager.execute(input, {
    rootPath: context.workspace.rootPath,
    read: async (filePath) => (await context.workspace.readEditorFile(filePath)).content,
    signal: context.signal,
  }) }),
})
