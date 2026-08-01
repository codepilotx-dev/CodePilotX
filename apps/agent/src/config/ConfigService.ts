import { createHash, randomUUID } from "node:crypto"
import { watch, type FSWatcher } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, parse as parsePath, relative, resolve } from "node:path"
import { parse as parseToml, type TomlTable } from "smol-toml"
import {
  JsoncDocumentError,
  parseJsoncObject,
  patchJsonc,
  stringifyConfigJson,
} from "./JsoncDocument"

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
  fromLegacy?: boolean
}

const EMPTY_VERSION = createHash("sha256").update("").digest("hex")
const PROJECT_CONFIG_DIRECTORY = ".codepilotx"
const CONFIG_FILE_NAME = "config.json"
const LEGACY_CONFIG_FILE_NAME = "config.toml"
const PROJECT_FORBIDDEN_ROOTS = new Set([
  "model_providers",
  "projects",
  "telemetry",
  "logging",
  "data_dir",
  "shell_security_level",
  "provider_credentials",
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
    const configDirectory = join(cursor, PROJECT_CONFIG_DIRECTORY)
    const candidate = join(configDirectory, CONFIG_FILE_NAME)
    const legacyCandidate = join(configDirectory, LEGACY_CONFIG_FILE_NAME)
    for (const existing of [candidate, legacyCandidate]) {
      try {
        if ((await stat(existing)).isFile()) return candidate
      } catch {}
    }
    const parent = dirname(cursor)
    if (parent === cursor || cursor === parsePath(cursor).root) return null
    cursor = parent
  }
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
  const providerCredentials = config.provider_credentials
  if (
    providerCredentials !== undefined
    && (
      !isObject(providerCredentials)
      || (
        providerCredentials.store !== undefined
        && providerCredentials.store !== "auth-json"
        && providerCredentials.store !== "encrypted"
      )
    )
  ) {
    throw new ConfigServiceError(
      "CONFIG_VALIDATION_ERROR",
      "配置 provider_credentials.store 仅支持 auth-json 或 encrypted",
    )
  }
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
  let missing = false
  try {
    text = await readFile(filePath, "utf8")
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
    missing = true
  }
  if (missing && previous?.fromLegacy) {
    return previous
  }
  try {
    const config = parseJsoncObject(text)
    validateConfig(config, scope)
    return { config, text, version: sha256(text), diagnostics: [] }
  } catch (cause) {
    const diagnostic: ConfigDiagnostic = {
      severity: "error",
      code: "CONFIG_VALIDATION_ERROR",
      message: `${scope === "user" ? "用户" : "项目"} config.json 无效；继续使用上次有效配置${
        cause instanceof JsoncDocumentError ? `：${cause.message}` : ""
      }`,
      scope,
    }
    return previous
      ? {
          ...previous,
          text,
          version: sha256(text),
          diagnostics: [diagnostic],
          fromLegacy: false,
        }
      : { config: {}, text, version: sha256(text), diagnostics: [diagnostic] }
  }
}

const fileExists = async (filePath: string) => {
  try {
    return (await stat(filePath)).isFile()
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false
    throw cause
  }
}

const legacyConfigPath = (filePath: string) =>
  join(dirname(filePath), LEGACY_CONFIG_FILE_NAME)

const writeConfigAtomically = async (filePath: string, text: string) => {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = join(dirname(filePath), `.${randomUUID()}.config.tmp`)
  try {
    await writeFile(temporary, text, "utf8")
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

const migrateLegacyToml = async (
  filePath: string,
  scope: ConfigScope,
): Promise<LoadedFile | undefined> => {
  if (await fileExists(filePath)) return undefined
  const legacyPath = legacyConfigPath(filePath)
  if (!await fileExists(legacyPath)) return undefined

  let config: ConfigObject
  let text: string
  try {
    const legacyText = await readFile(legacyPath, "utf8")
    config = asConfigObject(parseToml(legacyText))
    text = stringifyConfigJson(config)
    config = parseJsoncObject(text)
    validateConfig(config, scope)
  } catch {
    return {
      config: {},
      text: "{}\n",
      version: EMPTY_VERSION,
      fromLegacy: true,
      diagnostics: [{
        severity: "error",
        code: "CONFIG_VALIDATION_ERROR",
        message: `${scope === "user" ? "用户" : "项目"} config.toml 无效；未生成 config.json`,
        scope,
      }],
    }
  }

  try {
    if (await fileExists(filePath)) return undefined
    await writeConfigAtomically(filePath, text)
    const verified = await readConfigFile(filePath, scope)
    if (verified.diagnostics.some((item) => item.severity === "error")) {
      await rm(filePath, { force: true })
      throw new Error("config.json migration verification failed")
    }
    return verified
  } catch {
    return {
      config,
      text,
      version: EMPTY_VERSION,
      fromLegacy: true,
      diagnostics: [{
        severity: "warning",
        code: "CONFIG_MIGRATION_DEFERRED",
        message: `${scope === "user" ? "用户" : "项目"} config.toml 暂未迁移；当前继续使用旧配置`,
        scope,
      }],
    }
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
    const migrated = await migrateLegacyToml(this.userConfigPath, "user")
    if (!migrated && !await fileExists(this.userConfigPath)) {
      await writeFile(this.userConfigPath, "{}\n", {
        encoding: "utf8",
        flag: "wx",
      }).catch(() => undefined)
    }
    this.user = migrated
      ?? await readConfigFile(this.userConfigPath, "user")
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
      validateConfig(parseJsoncObject(text), scope)
    } catch (cause) {
      if (cause instanceof ConfigServiceError) throw cause
      throw new ConfigServiceError(
        "CONFIG_VALIDATION_ERROR",
        cause instanceof JsoncDocumentError
          ? cause.message
          : "config.json 语法无效",
      )
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
        if (fileName?.toString() !== basename(filePath)) return
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
    const migrated = trusted
      ? await migrateLegacyToml(filePath, "project")
      : undefined
    const loaded = migrated
      ?? await readConfigFile(filePath, "project", previous)
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
          message: "项目 config.json 尚未信任，当前已忽略",
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
      && resolve(filePath) === resolve(cwd, PROJECT_CONFIG_DIRECTORY, CONFIG_FILE_NAME)
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
      throw new ConfigServiceError("CONFIG_VERSION_CONFLICT", "config.json 已被其他编辑更新")
    }
    if (previous.diagnostics.some((item) => item.severity === "error")) {
      throw new ConfigServiceError("CONFIG_VALIDATION_ERROR", "请先修复 config.json 语法错误")
    }
    let text: string
    let parsed: ConfigObject
    try {
      text = patchJsonc(previous.text, input.edits)
      parsed = parseJsoncObject(text)
      validateConfig(parsed, target.scope)
    } catch (cause) {
      if (cause instanceof ConfigServiceError) throw cause
      throw new ConfigServiceError(
        "CONFIG_VALIDATION_ERROR",
        cause instanceof JsoncDocumentError
          ? cause.message
          : "配置修改产生了无效 JSONC",
      )
    }
    await writeConfigAtomically(target.filePath, text)
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
    const projects = isObject(this.user?.config.projects)
      ? this.user.config.projects as ConfigObject
      : {}
    const trust = isObject(projects[projectRoot])
      ? (projects[projectRoot] as ConfigObject).trust_level
      : undefined
    if (trust !== "trusted") return false
    const projectFile = join(
      projectRoot,
      PROJECT_CONFIG_DIRECTORY,
      CONFIG_FILE_NAME,
    )
    const migrated = await migrateLegacyToml(projectFile, "project")
    const previous = migrated ?? await readConfigFile(
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
    const result = await this.writeValue({
      keyPath: ["projects", projectRoot, "trust_level"],
      value: trustLevel,
      ...(expectedVersion ? { expectedVersion } : {}),
    })
    if (trustLevel === "trusted" && project) {
      await this.projectLayer(cwd)
    }
    return result
  }

  async notifyFileSaved(workspaceRoot: string, filePath: string) {
    if (filePath === "@codepilotx/config.json") {
      await this.refreshFile(this.userConfigPath, "user", [])
      return
    }
    if (filePath.replaceAll("\\", "/").toLowerCase() !== ".codepilotx/config.json") return
    const target = resolve(
      workspaceRoot,
      PROJECT_CONFIG_DIRECTORY,
      CONFIG_FILE_NAME,
    )
    await this.refreshFile(target, "project", [])
  }

  async dispose() {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer)
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.listeners.clear()
  }
}
