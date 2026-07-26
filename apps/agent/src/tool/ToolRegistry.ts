import { z, type ZodType } from "zod"
import { AgentError, type SubagentProfile, type TaskMode } from "../domain"
import { WorkspaceService } from "../workspace/WorkspaceService"
import type { PermissionConfig, SandboxMode } from "@codepilotx/shared/thread"
import type { Model } from "@codepilotx/model-schema"
import type { ToolExecutionMode as PiToolExecutionMode } from "@codepilotx/pi-agent-core"
import { isAbsolute, relative, resolve } from "node:path"
import { resolveManagedTool, runToolProcess, type ToolingResolver, type ToolProcessRunner } from "./ToolingRuntime"
import { nativeGlobWorkspace, nativeGrepWorkspace } from "./NativeWorkspaceSearch"

export type ToolCapabilities = {
  filesystem: "none" | "read" | "workspace-write" | "host-write"
  network: "none" | "declared" | "unrestricted"
  process: boolean
  externalState: boolean
  userInteraction: boolean
}

export type ApprovalStrategy = "policy" | "always-review" | "never-review"
export type ToolVisibility = "eager" | "deferred" | "internal"
export type ToolExecutionMode = PiToolExecutionMode
export type ToolProgress = { message: string; completed?: number; total?: number; details?: unknown }
export type ToolStructuredResult = { content: string; details: unknown; addedToolNames?: string[] }
export type PromptFactory = string | ((context: ToolContext) => string)
export type ToolOrigin =
  | { kind: "builtin" }
  | {
      kind: "mcp"
      serverName: string
      rawToolName: string
      generation: number
    }

export interface ToolCatalogEntry<Input = unknown, Output = unknown> {
  /** The sole canonical name exposed to the model. */
  sdkName: string
  /** Internal execution name. It is never exposed to the model. */
  name?: string
  schema: ZodType<Input>
  description: PromptFactory
  capabilities: ToolCapabilities
  allowedModes: readonly TaskMode[]
  allowedProfiles: readonly SubagentProfile[]
  approvalStrategy: ApprovalStrategy
  visibility: ToolVisibility
  executionMode: ToolExecutionMode
  inputSchema: Record<string, unknown>
  /** Structured provenance used by permission and routing decisions. */
  origin?: ToolOrigin
  progress?: (input: Input, context: ToolContext) => ToolProgress | undefined
  formatResult?: (output: Output, context: ToolContext) => ToolStructuredResult
}

export interface ToolContext {
  signal: AbortSignal
  taskMode: TaskMode
  profile?: SubagentProfile
  workspace: WorkspaceService
  permissionConfig: PermissionConfig
  model: Model.Ref
  onProgress?: (progress: ToolProgress) => void
  deferredTools?: readonly ToolCatalogEntry[]
  readSnapshot?: { mtimeMs: number; sha256: string }
  fileSaved?: (input: { filePath: string; content: string }) => Promise<void>
  resolveTooling?: ToolingResolver
  runToolProcess?: ToolProcessRunner
  /** Host-owned identity for this invocation. It is never derived from model input. */
  invocation?: Readonly<{
    threadID: string
    turnID: string
    agentID: string
    toolCallID: string
  }>
}

export interface ToolDefinition<Input = unknown, Output = unknown> extends ToolCatalogEntry<Input, Output> {
  execute(input: Input, context: ToolContext): Promise<Output>
}

const allModes = ["chat", "plan"] as const
const allProfiles = ["main", "default", "explorer", "worker"] as const
const noCapabilities = (): ToolCapabilities => ({ filesystem: "none", network: "none", process: false, externalState: false, userInteraction: false })
const jsonObject = (properties: Record<string, unknown>, required?: string[]) => ({ type: "object", properties, additionalProperties: false, ...(required ? { required } : {}) })
const shellSchema = z.object({
  command: z.string().min(1).max(32_000),
  timeout: z.number().positive().max(600_000).optional(),
  description: z.string().max(2_000).optional(),
}).strict()
const shellInputSchema = jsonObject({ command: { type: "string", maxLength: 32_000 }, timeout: { type: "number", maximum: 600_000 }, description: { type: "string", maxLength: 2_000 } }, ["command"])

const searchPaths = async (context: ToolContext, value?: string) => {
  if (!value?.trim()) {
    return context.workspace.roots.map((root) => ({
      root,
      target: ".",
      nativeTarget: root === context.workspace.rootPath ? "." : root,
    }))
  }
  const requested = value.trim()
  if (!isAbsolute(requested) && requested.split(/[\\/]+/).includes("..")) {
    throw new AgentError("WORKSPACE_PATH_DENIED", "搜索路径不得通过 .. 越出工作区", 403)
  }
  const canonical = await context.workspace.resolveDirectory(requested)
  const owner = context.workspace.rootForPath(canonical)
  if (!owner) throw new AgentError("WORKSPACE_PATH_DENIED", "搜索路径不在当前工作区内", 403)
  const child = relative(owner.path, canonical)
  return [{
    root: owner.path,
    target: child ? child.replaceAll("\\", "/") : ".",
    nativeTarget: context.workspace.displayPath(canonical),
  }]
}

const resolveRipgrep = async (context: ToolContext) => {
  const resolution = await (context.resolveTooling ?? resolveManagedTool)("ripgrep", { signal: context.signal })
  if (!resolution.available && (resolution.code === "TOOLING_ABORTED" || context.signal.aborted)) {
    throw new AgentError("RUN_ABORTED", "任务已停止", 499)
  }
  return resolution
}

const ripgrep = async (context: ToolContext, executable: string, args: readonly string[], cwd = context.workspace.rootPath) => {
  const result = await (context.runToolProcess ?? runToolProcess)({ executable, args, cwd, signal: context.signal, timeoutMs: 10_000, maxOutputBytes: 8 * 1024 * 1024 })
  if (result.exitCode !== 0 && result.exitCode !== 1) throw new AgentError("WORKSPACE_SEARCH_FAILED", result.stderr || `ripgrep 退出码 ${result.exitCode}`, 400)
  return result
}

type RgEvent = { type?: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number | null; submatches?: unknown[] } }

const grepWorkspace = async (input: any, context: ToolContext) => {
  const targets = await searchPaths(context, input.path)
  const resolution = await resolveRipgrep(context)
  if (!resolution.available) {
    const results = await Promise.all(targets.map((target) => nativeGrepWorkspace(
      { ...input, offset: 0, head_limit: 1_000 },
      context,
      target.nativeTarget,
    )))
    const offset = input.offset ?? 0
    const limit = input.head_limit ?? 200
    if (input.output_mode === "files_with_matches") {
      const files = results.flatMap((result) => "files" in result ? result.files : [])
      return { files: files.slice(offset, offset + limit), truncated: results.some((result) => result.truncated) || files.length > offset + limit, engine: "native-fallback" as const }
    }
    if (input.output_mode === "count") {
      const counts = results.flatMap((result) => "counts" in result ? result.counts : [])
      return { counts: counts.slice(offset, offset + limit), truncated: results.some((result) => result.truncated) || counts.length > offset + limit, engine: "native-fallback" as const }
    }
    const matches = results.flatMap((result) => "matches" in result ? result.matches : [])
    return { matches: matches.slice(offset, offset + limit), truncated: results.some((result) => result.truncated) || matches.length > offset + limit, engine: "native-fallback" as const }
  }
  const before = input["-B"] ?? input["-C"] ?? input.context ?? 0
  const after = input["-A"] ?? input["-C"] ?? input.context ?? 0
  const args = ["--json", "--color", "never", "--no-messages", "--sort", "path"]
  if (input["-i"]) args.push("--ignore-case")
  if (input.multiline) args.push("--multiline", "--multiline-dotall")
  if (before) args.push("--before-context", String(before))
  if (after) args.push("--after-context", String(after))
  if (input.glob) args.push("--glob", input.glob)
  if (input.type) args.push("--type", input.type)
  const matches: Array<{ path: string; line?: number; text: string; before?: string[]; after?: string[] }> = []
  const counts = new Map<string, number>()
  const contexts = new Map<string, Map<number, string>>()
  const searches = await Promise.all(targets.map(async (target) => ({
    target,
    result: await ripgrep(context, resolution.path, [...args, "--", input.pattern, target.target], target.root),
  })))
  for (const { target, result } of searches) {
    for (const raw of result.stdout.toString("utf8").split(/\r?\n/)) {
      if (!raw) continue
      let event: RgEvent
      try { event = JSON.parse(raw) as RgEvent } catch { throw new AgentError("WORKSPACE_SEARCH_INVALID_OUTPUT", "ripgrep 返回了无法解析的输出", 502) }
      const rawPath = event.data?.path?.text
      const path = rawPath
        ? context.workspace.displayPath(isAbsolute(rawPath) ? resolve(rawPath) : resolve(target.root, rawPath))
        : undefined
      const text = event.data?.lines?.text?.replace(/\r?\n$/, "")
      const line = event.data?.line_number ?? undefined
      if (!path || text === undefined || line === undefined) continue
      if (event.type === "context") {
        const byLine = contexts.get(path) ?? new Map<number, string>()
        byLine.set(line, text)
        contexts.set(path, byLine)
      } else if (event.type === "match") {
        const occurrences = Math.max(1, event.data?.submatches?.length ?? 1)
        counts.set(path, (counts.get(path) ?? 0) + occurrences)
        for (let index = 0; index < occurrences; index += 1) matches.push({ path, ...(input["-n"] === false ? {} : { line }), text: text.slice(0, 8_000) })
      }
    }
  }
  for (const match of matches) {
    if (match.line === undefined) continue
    const byLine = contexts.get(match.path)
    const prior = Array.from({ length: before }, (_, index) => byLine?.get(match.line! - before + index)).filter((line): line is string => line !== undefined)
    const following = Array.from({ length: after }, (_, index) => byLine?.get(match.line! + index + 1)).filter((line): line is string => line !== undefined)
    if (prior.length) match.before = prior
    if (following.length) match.after = following
  }
  const offset = input.offset ?? 0
  const limit = input.head_limit ?? 200
  if (input.output_mode === "files_with_matches") {
    const files = [...counts.keys()]
    return { files: files.slice(offset, offset + limit), truncated: files.length > offset + limit, engine: "ripgrep" as const }
  }
  if (input.output_mode === "count") {
    const values = [...counts].map(([path, count]) => ({ path, count }))
    return { counts: values.slice(offset, offset + limit), truncated: values.length > offset + limit, engine: "ripgrep" as const }
  }
  return { matches: matches.slice(offset, offset + limit), truncated: matches.length > offset + limit, engine: "ripgrep" as const }
}

const builtinTools = (): ToolDefinition<any, any>[] => [
  {
    sdkName: "Read", name: "workspace.read", description: "读取工作区内的 UTF-8 文本文件，并保存完整快照供后续写入使用。",
    schema: z.object({ file_path: z.string().min(1), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(10_000).optional() }).strict(),
    inputSchema: jsonObject({ file_path: { type: "string" }, offset: { type: "number", minimum: 0 }, limit: { type: "number", minimum: 1, maximum: 10_000 } }, ["file_path"]),
    capabilities: { ...noCapabilities(), filesystem: "read" }, allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "policy", visibility: "eager", executionMode: "parallel",
    progress: (input) => ({ message: `正在读取 ${input.file_path}` }),
    execute: async (input, context) => {
      const file = await context.workspace.readEditorFile(input.file_path)
      const offset = input.offset ?? 0
      const limit = input.limit ?? 400
      const lines = file.content.split(/\r?\n/)
      return { path: file.path, content: lines.slice(offset, offset + limit).join("\n"), offset, lineCount: lines.length, truncated: offset + limit < lines.length, sizeBytes: file.sizeBytes, snapshot: file.revision }
    },
  },
  {
    sdkName: "Write", name: "workspace.write", description: "创建或完整覆写工作区文件。已有文件必须先 Read，快照由执行器自动维护。",
    schema: z.object({ file_path: z.string().min(1), content: z.string() }).strict(),
    inputSchema: jsonObject({ file_path: { type: "string" }, content: { type: "string" } }, ["file_path", "content"]),
    capabilities: { ...noCapabilities(), filesystem: "workspace-write", externalState: true }, allowedModes: ["chat"], allowedProfiles: ["main", "default", "worker"], approvalStrategy: "policy", visibility: "eager", executionMode: "sequential",
    progress: (input) => ({ message: `正在写入 ${input.file_path}` }),
    execute: async (input, context) => {
      let current
      try { current = await context.workspace.readEditorFile(input.file_path) } catch (cause) {
        if (!(cause instanceof AgentError) || cause.code !== "WORKSPACE_PATH_NOT_FOUND") throw cause
      }
      if (!current) {
        const created = await context.workspace.applyPatch({ operation: "create", path: input.file_path, content: input.content })
        await context.fileSaved?.({ filePath: input.file_path, content: input.content })
        return created
      }
      if (!context.readSnapshot || context.readSnapshot.sha256 !== current.revision.sha256 || context.readSnapshot.mtimeMs !== current.revision.mtimeMs) throw new AgentError("WORKSPACE_FILE_STALE", "文件内容已变化或缺少完整 Read 快照，拒绝覆写", 409, { currentRevision: current.revision })
      const saved = await context.workspace.saveEditorFile(input.file_path, input.content, context.readSnapshot)
      if (saved.outcome === "conflict") throw new AgentError("WORKSPACE_FILE_STALE", "文件在写入前发生变化，拒绝覆写", 409, { currentRevision: saved.revision })
      await context.fileSaved?.({ filePath: current.path, content: input.content })
      return { operation: "write", path: current.path, beforeSha256: current.revision.sha256, afterSha256: saved.revision.sha256, revision: saved.revision }
    },
  },
  {
    sdkName: "Edit", name: "workspace.edit", description: "编辑工作区文件。文件必须先 Read；replace_all 默认为 false。",
    schema: z.object({ file_path: z.string().min(1), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().default(false) }).strict(),
    inputSchema: jsonObject({ file_path: { type: "string" }, old_string: { type: "string", minLength: 1 }, new_string: { type: "string" }, replace_all: { type: "boolean", default: false } }, ["file_path", "old_string", "new_string"]),
    capabilities: { ...noCapabilities(), filesystem: "workspace-write", externalState: true }, allowedModes: ["chat"], allowedProfiles: ["main", "default", "worker"], approvalStrategy: "policy", visibility: "eager", executionMode: "sequential",
    progress: (input) => ({ message: `正在编辑 ${input.file_path}` }),
    execute: async (input, context) => {
      const current = await context.workspace.readEditorFile(input.file_path)
      if (!context.readSnapshot || context.readSnapshot.sha256 !== current.revision.sha256 || context.readSnapshot.mtimeMs !== current.revision.mtimeMs) throw new AgentError("WORKSPACE_FILE_STALE", "文件内容已变化或缺少完整 Read 快照，拒绝编辑", 409, { currentRevision: current.revision })
      const first = current.content.indexOf(input.old_string)
      if (first < 0) throw new AgentError("PATCH_CONTEXT_NOT_FOUND", "编辑上下文未找到", 409)
      if (!input.replace_all && current.content.indexOf(input.old_string, first + 1) >= 0) throw new AgentError("PATCH_CONTEXT_AMBIGUOUS", "编辑上下文不唯一；如需全部替换请设置 replace_all", 409)
      const content = input.replace_all ? current.content.split(input.old_string).join(input.new_string) : `${current.content.slice(0, first)}${input.new_string}${current.content.slice(first + input.old_string.length)}`
      const saved = await context.workspace.saveEditorFile(input.file_path, content, context.readSnapshot)
      if (saved.outcome === "conflict") throw new AgentError("WORKSPACE_FILE_STALE", "文件在编辑前发生变化，拒绝写入", 409, { currentRevision: saved.revision })
      await context.fileSaved?.({ filePath: current.path, content })
      return { operation: "edit", path: current.path, beforeSha256: current.revision.sha256, afterSha256: saved.revision.sha256, revision: saved.revision }
    },
  },
  {
    sdkName: "Glob", name: "workspace.glob", description: "优先使用受管或本机 ripgrep 在工作区内按 glob 模式查找文件；无法获取 ripgrep 时使用有界原生搜索。path 默认为 .，优先传工作区相对路径，也接受工作区内绝对路径。",
    schema: z.object({ pattern: z.string().min(1).max(1_000), path: z.string().optional(), limit: z.number().int().min(1).max(500).optional() }).strict(),
    inputSchema: jsonObject({ pattern: { type: "string", maxLength: 1_000 }, path: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 500 } }, ["pattern"]),
    capabilities: { ...noCapabilities(), filesystem: "read", process: true }, allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "policy", visibility: "eager", executionMode: "parallel",
    progress: (input) => ({ message: `正在匹配 ${input.pattern}` }),
    execute: async (input, context) => {
      const targets = await searchPaths(context, input.path)
      const limit = input.limit ?? 200
      const resolution = await resolveRipgrep(context)
      if (!resolution.available) {
        const results = await Promise.all(targets.map((target) => nativeGlobWorkspace({ ...input, limit: 500 }, context, target.nativeTarget)))
        const all = results.flatMap((result) => result.matches).sort((left, right) => left.localeCompare(right))
        return { matches: all.slice(0, limit), truncated: results.some((result) => result.truncated) || all.length > limit, visited: results.reduce((sum, result) => sum + result.visited, 0), engine: "native-fallback" as const }
      }
      const all: string[] = []
      const searches = await Promise.all(targets.map(async (target) => ({
        target,
        result: await ripgrep(context, resolution.path, ["--files", "--null", "--color", "never", "--sort", "path", "--glob", input.pattern, "--", target.target], target.root),
      })))
      for (const { target, result } of searches) {
        all.push(...result.stdout.toString("utf8").split("\0").filter(Boolean).map((path) =>
          context.workspace.displayPath(isAbsolute(path) ? resolve(path) : resolve(target.root, path))))
      }
      all.sort((left, right) => left.localeCompare(right))
      return { matches: all.slice(0, limit), truncated: all.length > limit, visited: all.length, engine: "ripgrep" as const }
    },
  },
  {
    sdkName: "Grep", name: "workspace.grep", description: "优先使用受管或本机 ripgrep 在工作区内执行有界正则搜索；无法获取 ripgrep 时使用有界原生搜索。path 默认为 .，优先传工作区相对路径，也接受工作区内绝对路径；支持文件过滤、上下文和多种输出模式。",
    schema: z.object({ pattern: z.string().min(1).max(10_000), path: z.string().optional(), glob: z.string().max(1_000).optional(), output_mode: z.enum(["content", "files_with_matches", "count"]).default("content"), "-A": z.number().int().min(0).max(100).optional(), "-B": z.number().int().min(0).max(100).optional(), "-C": z.number().int().min(0).max(100).optional(), context: z.number().int().min(0).max(100).optional(), "-n": z.boolean().optional(), "-i": z.boolean().optional(), type: z.string().max(100).optional(), head_limit: z.number().int().min(1).max(1_000).default(200), offset: z.number().int().min(0).default(0), multiline: z.boolean().default(false) }).strict(),
    inputSchema: jsonObject({ pattern: { type: "string", maxLength: 10_000 }, path: { type: "string" }, glob: { type: "string", maxLength: 1_000 }, output_mode: { enum: ["content", "files_with_matches", "count"], default: "content" }, "-A": { type: "integer", minimum: 0, maximum: 100 }, "-B": { type: "integer", minimum: 0, maximum: 100 }, "-C": { type: "integer", minimum: 0, maximum: 100 }, context: { type: "integer", minimum: 0, maximum: 100 }, "-n": { type: "boolean" }, "-i": { type: "boolean" }, type: { type: "string", maxLength: 100 }, head_limit: { type: "integer", minimum: 1, maximum: 1_000, default: 200 }, offset: { type: "integer", minimum: 0, default: 0 }, multiline: { type: "boolean", default: false } }, ["pattern"]),
    capabilities: { ...noCapabilities(), filesystem: "read", process: true }, allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "policy", visibility: "eager", executionMode: "parallel",
    progress: (input) => ({ message: `正在搜索 ${input.pattern}` }),
    execute: grepWorkspace,
  },
  ...(["Bash", "PowerShell"] as const).map((sdkName): ToolDefinition<any, any> => ({
    sdkName, name: sdkName, description: sdkName === "Bash" ? "以工作区为默认 cwd，通过统一权限、Hook、幂等与沙箱边界执行 Bash 命令。禁止后台和绕过沙箱。" : "以工作区为默认 cwd，通过统一权限、Hook、幂等与沙箱边界执行 PowerShell 命令。禁止后台和绕过沙箱。",
    schema: shellSchema, inputSchema: shellInputSchema,
    capabilities: { filesystem: "host-write", network: "declared", process: true, externalState: true, userInteraction: false }, allowedModes: allModes, allowedProfiles: ["main", "default", "worker"], approvalStrategy: "policy", visibility: "eager", executionMode: "sequential",
    progress: () => ({ message: `正在执行 ${sdkName}` }),
    execute: async () => { throw new AgentError("SHELL_EXECUTOR_REQUIRED", `${sdkName} 必须经过统一执行器`, 500) },
  })),
  {
    sdkName: "ToolSearch", name: "tool.search", description: "搜索当前注册表中的延迟工具；用 select:<exact-name> 精确选择并请求激活。",
    schema: z.object({ query: z.string().min(1), max_results: z.number().int().min(1).max(20).default(5) }).strict(),
    inputSchema: jsonObject({ query: { type: "string", minLength: 1 }, max_results: { type: "integer", minimum: 1, maximum: 20, default: 5 } }, ["query"]),
    capabilities: noCapabilities(), allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "never-review", visibility: "eager", executionMode: "parallel",
    execute: async (input, context) => {
      const raw = input.query.trim()
      const selection = raw.match(/^select:(.+)$/i)?.[1]?.trim()
      const query = raw.toLowerCase()
      const tools = (context.deferredTools ?? []).filter((tool) => selection
        ? tool.sdkName === selection
        : tool.sdkName.toLowerCase().includes(query) || (typeof tool.description === "string" && tool.description.toLowerCase().includes(query))).slice(0, input.max_results)
      if (selection && tools.length === 0) throw new AgentError("DEFERRED_TOOL_NOT_FOUND", `延迟工具 ${selection} 不存在或不在当前权限范围内`, 404)
      return { tools: tools.map((tool) => ({ name: tool.sdkName, description: typeof tool.description === "string" ? tool.description : "动态工具" })), addedToolNames: selection ? tools.map((tool) => tool.sdkName) : [] }
    },
    formatResult: (output) => ({ content: JSON.stringify(output, null, 2), details: output, addedToolNames: output.addedToolNames }),
  },
  {
    sdkName: "request_permissions", name: "request_permissions", description: "为当前调用或 turn 请求临时权限。",
    schema: z.object({ scope: z.enum(["tool-call", "turn"]), readPaths: z.array(z.string()).optional(), writePaths: z.array(z.string()).optional(), networkDomains: z.array(z.string()).optional(), escalationToken: z.string().uuid().optional(), justification: z.string().min(1) }).strict(),
    inputSchema: jsonObject({ scope: { enum: ["tool-call", "turn"] }, readPaths: { type: "array", items: { type: "string" } }, writePaths: { type: "array", items: { type: "string" } }, networkDomains: { type: "array", items: { type: "string" } }, escalationToken: { type: "string", format: "uuid" }, justification: { type: "string" } }, ["scope", "justification"]),
    capabilities: { ...noCapabilities(), userInteraction: true }, allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "always-review", visibility: "internal", executionMode: "sequential",
    execute: async (input) => ({ granted: true, ...input }),
  },
]

export const toolMayMutate = (tool: ToolCatalogEntry) => tool.capabilities.filesystem === "workspace-write" || tool.capabilities.filesystem === "host-write" || tool.capabilities.externalState
export const toolAllowedInSandbox = (tool: ToolCatalogEntry, mode: SandboxMode) => mode !== "read-only" || tool.capabilities.filesystem !== "workspace-write"

export class ToolCatalog {
  private readonly tools = new Map<string, ToolDefinition<any, any>>()
  private readonly internalNames = new Map<string, string>()

  constructor(definitions: ToolDefinition<any, any>[] = builtinTools()) {
    for (const definition of definitions) this.register(definition)
  }

  register(tool: ToolDefinition<any, any>) {
    if (!tool.sdkName || !tool.schema || !tool.execute || !tool.capabilities || !tool.visibility || !tool.executionMode) throw new AgentError("INVALID_TOOL_DEFINITION", "工具定义不完整", 500)
    const internalName = tool.name ?? tool.sdkName
    if (this.tools.has(tool.sdkName) || this.internalNames.has(tool.sdkName) || this.internalNames.has(internalName) || this.tools.has(internalName)) throw new AgentError("TOOL_ALREADY_REGISTERED", `工具 ${tool.sdkName}/${internalName} 已注册`, 409)
    const frozen = Object.freeze({ ...tool, name: internalName, allowedModes: [...tool.allowedModes], allowedProfiles: [...tool.allowedProfiles], capabilities: Object.freeze({ ...tool.capabilities }) })
    this.tools.set(tool.sdkName, frozen)
    this.internalNames.set(internalName, tool.sdkName)
  }

  all() {
    return [...this.tools.values()]
  }

  list(mode?: TaskMode, sandboxMode: SandboxMode = "workspace-write", profile: SubagentProfile = "main") {
    return [...this.tools.values()].filter((tool) => (!mode || tool.allowedModes.includes(mode)) && tool.allowedProfiles.includes(profile) && toolAllowedInSandbox(tool, sandboxMode))
  }

  deferred(mode?: TaskMode, sandboxMode: SandboxMode = "workspace-write", profile: SubagentProfile = "main") {
    return this.list(mode, sandboxMode, profile).filter((tool) => tool.visibility === "deferred")
  }

  get(name: string) {
    const tool = this.tools.get(name) ?? this.tools.get(this.internalNames.get(name) ?? "")
    if (!tool) throw new AgentError("TOOL_NOT_FOUND", `工具 ${name} 不存在`, 404)
    return tool
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext) {
    const tool = this.get(name)
    if (!tool.allowedModes.includes(context.taskMode)) throw new AgentError("TOOL_NOT_ALLOWED_IN_MODE", `工具 ${name} 不允许在 ${context.taskMode} 模式执行`, 403)
    if (!tool.allowedProfiles.includes(context.profile ?? "main")) throw new AgentError("TOOL_NOT_ALLOWED_FOR_PROFILE", `工具 ${name} 不允许当前 Agent profile 使用`, 403)
    if (!toolAllowedInSandbox(tool, context.permissionConfig.sandboxMode)) throw new AgentError("TOOL_NOT_ALLOWED_IN_SANDBOX", `工具 ${name} 不允许在 ${context.permissionConfig.sandboxMode} 沙箱执行`, 403)
    if (context.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    const parsed = tool.schema.safeParse(input)
    if (!parsed.success) throw new AgentError("INVALID_TOOL_INPUT", parsed.error.message, 400)
    const progress = tool.progress?.(parsed.data, context)
    if (progress) context.onProgress?.(progress)
    return tool.execute(parsed.data, { ...context, deferredTools: context.deferredTools ?? this.deferred(context.taskMode, context.permissionConfig.sandboxMode, context.profile ?? "main") })
  }
}

/** Canonical Skill allowlists are exact and cannot reactivate removed aliases. */
export const allowedToolNameMatches = (name: string, allowedTools: readonly string[]) => allowedTools.includes(name)
export const toolNameMatches = (tool: Pick<ToolCatalogEntry, "sdkName">, allowedTools: readonly string[]) => allowedToolNameMatches(tool.sdkName, allowedTools)

/** @deprecated Use ToolCatalog. */
export class ToolRegistry extends ToolCatalog {}

/** Immutable per-turn view combining process-wide built-ins with scoped tools. */
export class TurnToolCatalog extends ToolCatalog {
  constructor(base: ToolCatalog, scoped: readonly ToolDefinition[]) {
    super([...base.all(), ...scoped])
  }
}
