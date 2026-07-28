import { createHash, randomUUID } from "node:crypto"
import { watch, type FSWatcher } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, parse as parsePath, relative, resolve } from "node:path"
import { parse, stringify, type TomlTable } from "smol-toml"
import { parseForESLint, type AST } from "toml-eslint-parser"

export type ConfigScope = "user" | "project"
export type ConfigMergeStrategy = "replace" | "upsert"
export type ConfigValue = null | boolean | number | string | ConfigValue[] | { [key: string]: ConfigValue }
export type ConfigObject = { [key: string]: ConfigValue }

export type ConfigDiagnostic = {
  severity: "warning" | "error"
  code: string
  message: string
  scope: ConfigScope
}

export type ConfigLayer = {
  kind: ConfigScope | "defaults"
  displayName: string
  filePath?: string
  version: string
  writable: boolean
  trusted: boolean
  config: ConfigObject
}

export type ConfigReadResult = {
  config: ConfigObject
  origins: Record<string, ConfigScope | "defaults">
  layers?: ConfigLayer[]
  diagnostics: ConfigDiagnostic[]
}

export type ConfigEdit = {
  keyPath: readonly string[]
  value: ConfigValue
  mergeStrategy?: ConfigMergeStrategy | undefined
}

export type ConfigWriteResult = {
  status: "ok" | "ok-overridden"
  version: string
  filePath: string
  overridden?: Array<{ keyPath: string[]; by: ConfigScope }>
}

export type ConfigUpdated = {
  version: string
  changedKeyPaths: string[][]
  scope: ConfigScope
  diagnostics: ConfigDiagnostic[]
}

export type ConfigErrorCode =
  | "CONFIG_LAYER_READONLY"
  | "CONFIG_VERSION_CONFLICT"
  | "CONFIG_VALIDATION_ERROR"
  | "CONFIG_PATH_NOT_FOUND"
  | "CONFIG_PROJECT_UNTRUSTED"

export class ConfigServiceError extends Error {
  constructor(
    readonly code: ConfigErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "ConfigServiceError"
  }
}

type LoadedFile = {
  config: ConfigObject
  text: string
  version: string
  diagnostics: ConfigDiagnostic[]
}

const EMPTY_VERSION = createHash("sha256").update("").digest("hex")
const PROJECT_CONFIG_PARTS = [".codepilotx", "config.toml"] as const
const PROJECT_FORBIDDEN_ROOTS = new Set([
  "model_providers",
  "projects",
  "telemetry",
  "logging",
  "data_dir",
  "shell_security_level",
])
const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const STATIC_SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
])
const isSecretMaterialKey = (key: string) => {
  const normalized = key.replace(/[-_]/g, "").toLowerCase()
  if (/(?:env|environment|credentialid|credentialref|secretid)$/.test(normalized)) {
    return false
  }
  return [
    "apikey",
    "oauthtoken",
    "accesstoken",
    "refreshtoken",
    "clientsecret",
    "password",
    "privatekey",
  ].some((part) => normalized === part || normalized.endsWith(part))
}

const isMcpEnvironmentReferencePath = (path: readonly string[]) =>
  (
    path.length === 5
    && path[0] === "mcp_servers"
    && path[2] === "transport"
    && (path[3] === "envFromHost" || path[3] === "headerFromEnv")
  )
  || (
    path.length === 4
    && path[0] === "mcp_servers"
    && path[2] === "transport"
    && path[3] === "bearerTokenEnvVar"
  )

const isStaticMcpSecretHeaderPath = (path: readonly string[]) =>
  path.length === 5
  && path[0] === "mcp_servers"
  && path[2] === "transport"
  && path[3] === "headers"
  && STATIC_SECRET_HEADERS.has(path[4]!.toLowerCase())

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asConfigObject = (value: TomlTable): ConfigObject =>
  value as unknown as ConfigObject

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex")

const clone = <T>(value: T): T => structuredClone(value)

const mergeConfig = (base: ConfigObject, next: ConfigObject): ConfigObject => {
  const output = clone(base)
  for (const [key, value] of Object.entries(next)) {
    const current = output[key]
    output[key] = isObject(current) && isObject(value)
      ? mergeConfig(current as ConfigObject, value as ConfigObject)
      : clone(value)
  }
  return output
}

const valueAtPath = (config: ConfigObject, keyPath: readonly string[]) => {
  let current: ConfigValue | ConfigObject = config
  for (const key of keyPath) {
    if (!isObject(current) || !(key in current)) return undefined
    current = current[key]!
  }
  return current
}

const collectOrigins = (
  value: ConfigObject,
  scope: ConfigScope | "defaults",
  output: Record<string, ConfigScope | "defaults">,
  prefix: string[] = [],
) => {
  for (const [key, child] of Object.entries(value)) {
    const path = [...prefix, key]
    if (isObject(child)) collectOrigins(child as ConfigObject, scope, output, path)
    else output[path.join(".")] = scope
  }
}

const findProjectConfig = async (cwd: string): Promise<string | null> => {
  let cursor = resolve(cwd)
  while (true) {
    const candidate = join(cursor, ...PROJECT_CONFIG_PARTS)
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch {}
    const parent = dirname(cursor)
    if (parent === cursor || cursor === parsePath(cursor).root) return null
    cursor = parent
  }
}

const keyName = (key: AST.TOMLKey) =>
  key.keys.map((part) => part.type === "TOMLBare" ? part.name : part.value)

const fullKeyPath = (node: AST.TOMLKeyValue): string[] => {
  const parent = node.parent
  if (parent.type === "TOMLTable") {
    return [...parent.resolvedKey.map(String), ...keyName(node.key)]
  }
  return keyName(node.key)
}

const locateKeyValue = (text: string, keyPath: readonly string[]) => {
  if (!text.trim()) return undefined
  const ast = parseForESLint(text, { tomlVersion: "1.0" }).ast
  for (const item of ast.body[0].body) {
    if (item.type === "TOMLKeyValue" && fullKeyPath(item).join("\0") === keyPath.join("\0")) return item
    if (item.type === "TOMLTable") {
      for (const entry of item.body) {
        if (fullKeyPath(entry).join("\0") === keyPath.join("\0")) return entry
      }
    }
  }
  return undefined
}

const locateTables = (text: string, keyPath: readonly string[]) => {
  if (!text.trim()) return []
  const ast = parseForESLint(text, { tomlVersion: "1.0" }).ast
  return ast.body[0].body.filter(
    (item): item is AST.TOMLTable =>
      item.type === "TOMLTable"
      && item.resolvedKey.length >= keyPath.length
      && keyPath.every((part, index) => String(item.resolvedKey[index]) === part),
  )
}

const tomlKey = (key: string) =>
  /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)

const serializeValue = (value: Exclude<ConfigValue, null>): string => {
  if (Array.isArray(value)) {
    return `[${value.map((child) => {
      if (child === null) {
        throw new ConfigServiceError("CONFIG_VALIDATION_ERROR", "TOML 数组不支持 null")
      }
      return serializeValue(child)
    }).join(", ")}]`
  }
  if (isObject(value)) {
    const pairs = Object.entries(value).map(([key, child]) => {
      if (child === null || isObject(child)) {
        throw new ConfigServiceError(
          "CONFIG_VALIDATION_ERROR",
          "对象配置必须通过叶子 key path 写入",
        )
      }
      return `${tomlKey(key)} = ${serializeValue(child as Exclude<ConfigValue, null>)}`
    })
    return `{ ${pairs.join(", ")} }`
  }
  const rendered = stringify({ value: value as never }).trim()
  const equals = rendered.indexOf("=")
  if (equals < 0) throw new ConfigServiceError("CONFIG_VALIDATION_ERROR", "无法序列化配置值")
  return rendered.slice(equals + 1).trim()
}

const lineRange = (text: string, range: readonly [number, number]) => {
  const start = text.lastIndexOf("\n", Math.max(0, range[0] - 1)) + 1
  const next = text.indexOf("\n", range[1])
  return [start, next < 0 ? text.length : next + 1] as const
}

const editToml = (source: string, edit: ConfigEdit): string => {
  if (edit.keyPath.length === 0 || edit.keyPath.some((part) => !part.trim())) {
    throw new ConfigServiceError("CONFIG_VALIDATION_ERROR", "配置 key path 无效")
  }
  const existing = locateKeyValue(source, edit.keyPath)
  if (existing) {
    if (edit.value === null) {
      const [start, end] = lineRange(source, existing.range)
      return source.slice(0, start) + source.slice(end)
    }
    const replacement = serializeValue(edit.value)
    return source.slice(0, existing.value.range[0]) + replacement + source.slice(existing.value.range[1])
  }
  if (edit.value === null) {
    return locateTables(source, edit.keyPath)
      .sort((left, right) => right.range[0] - left.range[0])
      .reduce((text, table) => {
        const [start, end] = lineRange(text, table.range)
        return text.slice(0, start) + text.slice(end)
      }, source)
  }

  const tablePath = edit.keyPath.slice(0, -1)
  const leaf = edit.keyPath.at(-1)!
  const line = `${tomlKey(leaf)} = ${serializeValue(edit.value)}\n`
  if (tablePath.length === 0) {
    const ast = source.trim() ? parseForESLint(source, { tomlVersion: "1.0" }).ast : null
    const firstTable = ast?.body[0].body.find((item) => item.type === "TOMLTable")
    const insertion = firstTable?.range[0] ?? source.length
    const prefix = insertion > 0 && !source.slice(0, insertion).endsWith("\n") ? "\n" : ""
    return source.slice(0, insertion) + prefix + line + source.slice(insertion)
  }

  const ast = source.trim() ? parseForESLint(source, { tomlVersion: "1.0" }).ast : null
  const table = ast?.body[0].body.find(
    (item): item is AST.TOMLTable =>
      item.type === "TOMLTable"
      && item.kind === "standard"
      && item.resolvedKey.map(String).join("\0") === tablePath.join("\0"),
  )
  if (table) {
    const insertion = table.body.at(-1)?.range[1] ?? table.range[1]
    const nextNewline = source.indexOf("\n", insertion)
    const at = nextNewline < 0 ? source.length : nextNewline + 1
    const prefix = at > 0 && !source.slice(0, at).endsWith("\n") ? "\n" : ""
    return source.slice(0, at) + prefix + line + source.slice(at)
  }

  const prefix = source.length === 0
    ? ""
    : source.endsWith("\n\n")
      ? ""
      : source.endsWith("\n")
        ? "\n"
        : "\n\n"
  return `${source}${prefix}[${tablePath.map(tomlKey).join(".")}]\n${line}`
}

const validateConfig = (config: ConfigObject, scope: ConfigScope) => {
  const visit = (value: ConfigObject, prefix: string[] = []) => {
    for (const [key, child] of Object.entries(value)) {
      const path = [...prefix, key]
      if (isMcpEnvironmentReferencePath(path)) {
        if (typeof child !== "string" || !ENVIRONMENT_VARIABLE_NAME.test(child)) {
          throw new ConfigServiceError(
            "CONFIG_VALIDATION_ERROR",
            `配置 ${path.join(".")} 的环境变量名无效`,
          )
        }
        continue
      }
      if (isStaticMcpSecretHeaderPath(path)) {
        throw new ConfigServiceError(
          "CONFIG_VALIDATION_ERROR",
          `配置 ${path.join(".")} 不允许保存密钥材料`,
        )
      }
      if (isSecretMaterialKey(key) && typeof child === "string" && child.trim()) {
        throw new ConfigServiceError(
          "CONFIG_VALIDATION_ERROR",
          `配置 ${path.join(".")} 不允许保存密钥材料`,
        )
      }
      if (isObject(child)) visit(child as ConfigObject, path)
    }
  }
  visit(config)
  if (scope === "project") {
    for (const root of Object.keys(config)) {
      if (PROJECT_FORBIDDEN_ROOTS.has(root) || root === "desktop") {
        throw new ConfigServiceError(
          "CONFIG_LAYER_READONLY",
          `项目配置不允许覆盖 ${root}`,
        )
      }
    }
  }
}

const readConfigFile = async (
  filePath: string,
  scope: ConfigScope,
  previous?: LoadedFile,
): Promise<LoadedFile> => {
  let text = ""
  try {
    text = await readFile(filePath, "utf8")
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
  }
  try {
    const config = asConfigObject(parse(text))
    validateConfig(config, scope)
    return { config, text, version: sha256(text), diagnostics: [] }
  } catch {
    const diagnostic: ConfigDiagnostic = {
      severity: "error",
      code: "CONFIG_VALIDATION_ERROR",
      message: `${scope === "user" ? "用户" : "项目"} config.toml 无效；继续使用上次有效配置`,
      scope,
    }
    return previous
      ? { ...previous, text, version: sha256(text), diagnostics: [diagnostic] }
      : { config: {}, text, version: sha256(text), diagnostics: [diagnostic] }
  }
}

type ConfigBatchWriteInput = {
  edits: readonly ConfigEdit[]
  filePath?: string | undefined
  cwd?: string | undefined
  expectedVersion?: string | undefined
  migrationScope?: ConfigScope | undefined
}

type ConfigWriteTarget = {
  scope: ConfigScope
  filePath: string
}

const writeQueueKey = (filePath: string) => {
  const normalized = resolve(filePath)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

export class ConfigService {
  private user: LoadedFile | undefined
  private projects = new Map<string, LoadedFile>()
  private watchers = new Map<string, FSWatcher>()
  private listeners = new Set<(event: ConfigUpdated) => void | Promise<void>>()
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private writeQueues = new Map<string, Promise<void>>()

  constructor(
    readonly userConfigPath: string,
    private readonly defaults: ConfigObject = {},
  ) {}

  async initialize() {
    await mkdir(dirname(this.userConfigPath), { recursive: true })
    try {
      await stat(this.userConfigPath)
    } catch {
      await writeFile(this.userConfigPath, "", { encoding: "utf8", flag: "wx" }).catch(() => undefined)
    }
    this.user = await readConfigFile(this.userConfigPath, "user")
    this.watchFile(this.userConfigPath, "user")
  }

  snapshot(): ConfigObject {
    return mergeConfig(this.defaults, this.user?.config ?? {})
  }

  snapshotLayers(cwd?: string): ConfigLayer[] {
    const layers: ConfigLayer[] = [{
      kind: "user",
      displayName: "用户配置",
      filePath: this.userConfigPath,
      version: this.user?.version ?? EMPTY_VERSION,
      writable: true,
      trusted: true,
      config: clone(this.user?.config ?? {}),
    }]
    if (!cwd || !isAbsolute(cwd)) return layers
    const canonicalCwd = resolve(cwd)
    const match = [...this.projects.entries()]
      .map(([filePath, loaded]) => ({
        filePath,
        loaded,
        projectRoot: dirname(dirname(filePath)),
      }))
      .filter(({ projectRoot }) => {
        const child = relative(projectRoot, canonicalCwd)
        return child === "" || (!child.startsWith("..") && !isAbsolute(child))
      })
      .sort((left, right) => right.projectRoot.length - left.projectRoot.length)[0]
    if (!match) return layers
    const projects = this.user?.config.projects
    const trusted = isObject(projects)
      && isObject(projects[resolve(match.projectRoot)])
      && (projects[resolve(match.projectRoot)] as ConfigObject).trust_level === "trusted"
    layers.push({
      kind: "project",
      displayName: "项目配置",
      filePath: match.filePath,
      version: match.loaded.version,
      writable: trusted,
      trusted,
      config: clone(match.loaded.config),
    })
    return layers
  }

  validateDocument(text: string, scope: ConfigScope) {
    try {
      validateConfig(asConfigObject(parse(text)), scope)
    } catch (cause) {
      if (cause instanceof ConfigServiceError) throw cause
      throw new ConfigServiceError("CONFIG_VALIDATION_ERROR", "config.toml 语法无效")
    }
  }

  subscribe(listener: (event: ConfigUpdated) => void | Promise<void>) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ConfigUpdated) {
    for (const listener of this.listeners) void listener(event)
  }

  private watchFile(filePath: string, scope: ConfigScope) {
    const directory = dirname(filePath)
    if (this.watchers.has(filePath)) return
    try {
      const watcher = watch(directory, (_event, fileName) => {
        if (fileName?.toString() !== filePath.slice(directory.length + 1)) return
        const oldTimer = this.refreshTimers.get(filePath)
        if (oldTimer) clearTimeout(oldTimer)
        this.refreshTimers.set(filePath, setTimeout(() => {
          void this.refreshFile(filePath, scope, [])
        }, 80))
      })
      this.watchers.set(filePath, watcher)
    } catch {}
  }

  private async refreshFile(filePath: string, scope: ConfigScope, changedKeyPaths: string[][]) {
    const previous = scope === "user" ? this.user : this.projects.get(filePath)
    const loaded = await readConfigFile(filePath, scope, previous)
    if (scope === "user") this.user = loaded
    else this.projects.set(filePath, loaded)
    if (previous?.version !== loaded.version || changedKeyPaths.length > 0) {
      this.emit({
        version: loaded.version,
        changedKeyPaths,
        scope,
        diagnostics: loaded.diagnostics,
      })
    }
    return loaded
  }

  private async projectLayer(cwd?: string) {
    if (!cwd || !isAbsolute(cwd)) return null
    const filePath = await findProjectConfig(cwd)
    if (!filePath) return null
    const userConfig = this.user?.config ?? {}
    const projectRoot = dirname(dirname(filePath))
    const trusted = isObject(userConfig.projects)
      && isObject((userConfig.projects as ConfigObject)[resolve(projectRoot)])
      && ((userConfig.projects as ConfigObject)[resolve(projectRoot)] as ConfigObject).trust_level === "trusted"
    const previous = this.projects.get(filePath)
    const loaded = await readConfigFile(filePath, "project", previous)
    this.projects.set(filePath, loaded)
    this.watchFile(filePath, "project")
    return { filePath, projectRoot, trusted, loaded }
  }

  async read(options: { includeLayers?: boolean | undefined; cwd?: string | undefined } = {}): Promise<ConfigReadResult> {
    if (!this.user) await this.initialize()
    this.user = await readConfigFile(this.userConfigPath, "user", this.user)
    const project = await this.projectLayer(options.cwd)
    const origins: Record<string, ConfigScope | "defaults"> = {}
    collectOrigins(this.defaults, "defaults", origins)
    collectOrigins(this.user.config, "user", origins)
    let config = mergeConfig(this.defaults, this.user.config)
    const diagnostics = [...this.user.diagnostics]
    if (project) {
      if (project.trusted) {
        config = mergeConfig(config, project.loaded.config)
        collectOrigins(project.loaded.config, "project", origins)
        diagnostics.push(...project.loaded.diagnostics)
      } else {
        diagnostics.push({
          severity: "warning",
          code: "CONFIG_PROJECT_UNTRUSTED",
          message: "项目 config.toml 尚未信任，当前已忽略",
          scope: "project",
        })
      }
    }
    const layers = options.includeLayers
      ? [
          {
            kind: "defaults" as const,
            displayName: "内置默认值",
            version: EMPTY_VERSION,
            writable: false,
            trusted: true,
            config: clone(this.defaults),
          },
          {
            kind: "user" as const,
            displayName: "用户配置",
            filePath: this.userConfigPath,
            version: this.user.version,
            writable: true,
            trusted: true,
            config: clone(this.user.config),
          },
          ...(project
            ? [{
                kind: "project" as const,
                displayName: "项目配置",
                filePath: project.filePath,
                version: project.loaded.version,
                writable: project.trusted,
                trusted: project.trusted,
                config: clone(project.loaded.config),
              }]
            : []),
        ]
      : undefined
    return {
      config,
      origins,
      ...(layers ? { layers } : {}),
      diagnostics,
    }
  }

  private async resolveWriteTarget(filePath?: string, cwd?: string) {
    if (!filePath || resolve(filePath) === resolve(this.userConfigPath)) {
      return { scope: "user" as const, filePath: this.userConfigPath }
    }
    const project = await this.projectLayer(cwd ?? dirname(dirname(filePath)))
    if (
      !project
      && cwd
      && resolve(filePath) === resolve(cwd, ".codepilotx", "config.toml")
    ) {
      const projectRoot = resolve(cwd)
      const projects = isObject(this.user?.config.projects)
        ? this.user.config.projects as ConfigObject
        : {}
      const trust = isObject(projects[projectRoot])
        ? (projects[projectRoot] as ConfigObject).trust_level
        : undefined
      if (trust !== "trusted") {
        throw new ConfigServiceError("CONFIG_PROJECT_UNTRUSTED", "项目配置尚未信任")
      }
      return { scope: "project" as const, filePath: resolve(filePath) }
    }
    if (!project || resolve(project.filePath) !== resolve(filePath)) {
      throw new ConfigServiceError("CONFIG_PATH_NOT_FOUND", "配置文件不属于当前用户或项目层")
    }
    if (!project.trusted) {
      throw new ConfigServiceError("CONFIG_PROJECT_UNTRUSTED", "项目配置尚未信任")
    }
    return { scope: "project" as const, filePath: project.filePath }
  }

  private async performBatchWrite(
    input: ConfigBatchWriteInput,
    target: ConfigWriteTarget,
  ): Promise<ConfigWriteResult> {
    if (target.scope === "project" && !input.migrationScope) {
      this.user = await readConfigFile(this.userConfigPath, "user", this.user)
      const projectRoot = resolve(dirname(dirname(target.filePath)))
      const projects = isObject(this.user.config.projects)
        ? this.user.config.projects as ConfigObject
        : {}
      const trust = isObject(projects[projectRoot])
        ? (projects[projectRoot] as ConfigObject).trust_level
        : undefined
      if (trust !== "trusted") {
        throw new ConfigServiceError("CONFIG_PROJECT_UNTRUSTED", "项目配置尚未信任")
      }
    }
    const previous = await readConfigFile(
      target.filePath,
      target.scope,
      target.scope === "user" ? this.user : this.projects.get(target.filePath),
    )
    if (input.expectedVersion && input.expectedVersion !== previous.version) {
      throw new ConfigServiceError("CONFIG_VERSION_CONFLICT", "config.toml 已被其他编辑更新")
    }
    if (previous.diagnostics.some((item) => item.severity === "error")) {
      throw new ConfigServiceError("CONFIG_VALIDATION_ERROR", "请先修复 config.toml 语法错误")
    }
    let text = previous.text
    for (const edit of input.edits) text = editToml(text, edit)
    let parsed: ConfigObject
    try {
      parsed = asConfigObject(parse(text))
      validateConfig(parsed, target.scope)
    } catch (cause) {
      if (cause instanceof ConfigServiceError) throw cause
      throw new ConfigServiceError("CONFIG_VALIDATION_ERROR", "配置修改产生了无效 TOML")
    }
    await mkdir(dirname(target.filePath), { recursive: true })
    const temporary = join(dirname(target.filePath), `.${randomUUID()}.config.tmp`)
    try {
      await writeFile(temporary, text, "utf8")
      await rename(temporary, target.filePath)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    const loaded = await this.refreshFile(
      target.filePath,
      target.scope,
      input.edits.map((edit) => [...edit.keyPath]),
    )

    const effective = await this.read({ cwd: input.cwd })
    const overridden = input.edits
      .filter((edit) => edit.value !== null)
      .map((edit) => ({ keyPath: [...edit.keyPath], by: effective.origins[edit.keyPath.join(".")] }))
      .filter((item): item is { keyPath: string[]; by: ConfigScope } =>
        item.by === "project" || item.by === "user")
      .filter((item) => item.by !== target.scope)
    return {
      status: overridden.length > 0 ? "ok-overridden" : "ok",
      version: loaded.version,
      filePath: target.filePath,
      ...(overridden.length ? { overridden } : {}),
    }
  }

  async batchWrite(input: ConfigBatchWriteInput): Promise<ConfigWriteResult> {
    if (!this.user) await this.initialize()
    const target = input.migrationScope && input.filePath
      ? { scope: input.migrationScope, filePath: resolve(input.filePath) }
      : await this.resolveWriteTarget(input.filePath, input.cwd)
    const pathKey = writeQueueKey(target.filePath)
    const task = (this.writeQueues.get(pathKey) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.performBatchWrite(input, target))
    const tail = task.then(
      () => undefined,
      () => undefined,
    )
    this.writeQueues.set(pathKey, tail)
    void tail.then(() => {
      if (this.writeQueues.get(pathKey) === tail) this.writeQueues.delete(pathKey)
    })
    return task
  }

  async writeValue(input: ConfigEdit & {
    filePath?: string | undefined
    cwd?: string | undefined
    expectedVersion?: string | undefined
  }) {
    return this.batchWrite({
      edits: [{
        keyPath: input.keyPath,
        value: input.value,
        ...(input.mergeStrategy ? { mergeStrategy: input.mergeStrategy } : {}),
      }],
      ...(input.filePath ? { filePath: input.filePath } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
    })
  }

  async resolveUnresolvedMcp(cwd: string) {
    if (!isAbsolute(cwd)) return false
    const projectRoot = resolve(cwd)
    const hash = createHash("sha256")
      .update(projectRoot.toLowerCase())
      .digest("hex")
    const servers = valueAtPath(
      this.user?.config ?? {},
      ["migration", "unresolved_mcp", hash],
    )
    if (!isObject(servers)) return false
    const projectFile = join(projectRoot, ...PROJECT_CONFIG_PARTS)
    const previous = await readConfigFile(
      projectFile,
      "project",
      this.projects.get(projectFile),
    )
    const edits: ConfigEdit[] = []
    const addMissingLeaves = (value: ConfigObject, prefix: string[]) => {
      for (const [key, child] of Object.entries(value)) {
        const path = [...prefix, key]
        if (isObject(child)) addMissingLeaves(child as ConfigObject, path)
        else if (valueAtPath(previous.config, path) === undefined) {
          edits.push({ keyPath: path, value: clone(child) })
        }
      }
    }
    addMissingLeaves(servers as ConfigObject, ["mcp_servers"])
    if (edits.length) {
      await this.batchWrite({
        edits,
        filePath: projectFile,
        migrationScope: "project",
      })
    }
    await this.batchWrite({
      edits: [{
        keyPath: ["migration", "unresolved_mcp", hash],
        value: null,
      }],
    })
    return true
  }

  async trustRead(cwd: string) {
    const project = await this.projectLayer(cwd)
    const projectRoot = resolve(project?.projectRoot ?? cwd)
    const projects = isObject(this.user?.config.projects)
      ? this.user.config.projects as ConfigObject
      : {}
    const trusted = project?.trusted === true
      || (isObject(projects[projectRoot])
        && (projects[projectRoot] as ConfigObject).trust_level === "trusted")
    return {
      projectRoot,
      trustLevel: trusted ? "trusted" as const : "untrusted" as const,
      hasProjectConfig: project !== null,
    }
  }

  async trustUpdate(cwd: string, trustLevel: "trusted" | "untrusted", expectedVersion?: string) {
    const project = await this.projectLayer(cwd)
    const projectRoot = resolve(project?.projectRoot ?? cwd)
    return this.writeValue({
      keyPath: ["projects", projectRoot, "trust_level"],
      value: trustLevel,
      ...(expectedVersion ? { expectedVersion } : {}),
    })
  }

  async notifyFileSaved(workspaceRoot: string, filePath: string) {
    if (filePath === "@codepilotx/config.toml") {
      await this.refreshFile(this.userConfigPath, "user", [])
      return
    }
    if (filePath.replaceAll("\\", "/").toLowerCase() !== ".codepilotx/config.toml") return
    const target = resolve(workspaceRoot, ".codepilotx", "config.toml")
    await this.refreshFile(target, "project", [])
  }

  async dispose() {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer)
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.listeners.clear()
  }
}
