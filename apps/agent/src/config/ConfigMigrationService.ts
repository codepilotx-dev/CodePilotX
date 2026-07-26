import type { ConfigEdit, ConfigObject, ConfigService, ConfigValue } from "./ConfigService"
import type {
  ConfigMigrationRepository,
} from "../storage/repositories/config-migration-repository"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"

const DESKTOP_RUNTIME_KEYS = new Set([
  "recentWorkspaces",
  "lastActiveWorkspacePath",
  "removedWorkspaces",
  "currentDrawer",
  "drawer",
  "drawerTab",
  "collapsed",
  "collapsedSections",
  "pinnedSessions",
  "sessionPins",
  "manualSessionOrder",
  "sidebarStateVersion",
  "sidebarManualOrder",
  "sidebarSessionPins",
  "collapsedSidebarProjectPaths",
  "sidebarSectionOrder",
  "collapsedSidebarSections",
  "windowBounds",
  "overlayPosition",
  "migrationVersion",
  "settingsVersion",
  "workspaceDependenciesMigrated",
])
const DESKTOP_CORE_PATHS: Record<string, string[]> = {
  model: ["model"],
  providerID: ["model_provider"],
  thinkingMode: ["model_reasoning_effort"],
  personality: ["personality"],
  systemPrompt: ["system_prompt"],
  appendSystemPrompt: ["append_system_prompt"],
  customInstructions: ["custom_instructions"],
  smallFastModel: ["task_models", "small_fast"],
  fastModel: ["task_models", "fast"],
  defaultModel: ["task_models", "default"],
  deepModel: ["task_models", "deep"],
  planExecutionModel: ["task_models", "plan"],
  reviewModel: ["task_models", "reviewer"],
  enableMemory: ["features", "memory"],
  enableParetoCodeRouter: ["features", "pareto_code_router"],
  enableFusionRouter: ["features", "fusion_router"],
  allowNetworkAccess: ["sandbox_workspace_write", "network_access"],
}
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const atPath = (value: ConfigObject, path: readonly string[]) => {
  let cursor: unknown = value
  for (const part of path) {
    if (!isObject(cursor) || !(part in cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

const safeValue = (value: unknown): ConfigValue | undefined => {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "string"
    || (typeof value === "number" && Number.isFinite(value))
  ) return value
  if (Array.isArray(value)) {
    const children = value.map(safeValue)
    return children.every((child) => child !== undefined) ? children as ConfigValue[] : undefined
  }
  if (isObject(value)) {
    const output: Record<string, ConfigValue> = {}
    for (const [key, child] of Object.entries(value)) {
      if (isSecretMaterialKey(key)) continue
      const safe = safeValue(child)
      if (safe !== undefined) output[key] = safe
    }
    return output
  }
  return undefined
}

const addMissingLeaves = (
  edits: ConfigEdit[],
  current: ConfigObject,
  prefix: string[],
  value: Record<string, unknown>,
) => {
  for (const [key, child] of Object.entries(value)) {
    const path = [...prefix, key]
    if (atPath(current, path) !== undefined) continue
    if (isObject(child)) addMissingLeaves(edits, current, path, child)
    else {
      const safe = safeValue(child)
      if (safe !== undefined) edits.push({ keyPath: path, value: safe })
    }
  }
}

const addLegacyDesktopEdits = (
  edits: ConfigEdit[],
  current: ConfigObject,
  desktop: Record<string, unknown>,
) => {
  for (const [key, value] of Object.entries(desktop)) {
    if (DESKTOP_RUNTIME_KEYS.has(key)) continue
    if (key === "permissionConfig" && isObject(value)) {
      const permissionPaths: Record<string, string[]> = {
        approvalPolicy: ["approval_policy"],
        approvalsReviewer: ["approvals_reviewer"],
        sandboxMode: ["sandbox_mode"],
      }
      for (const [permissionKey, permissionValue] of Object.entries(value)) {
        const path = permissionPaths[permissionKey]
        const safe = safeValue(permissionValue)
        if (path && safe !== undefined && atPath(current, path) === undefined) {
          edits.push({ keyPath: path, value: safe })
        }
      }
      continue
    }
    const path = DESKTOP_CORE_PATHS[key] ?? ["desktop", key]
    if (atPath(current, path) !== undefined) continue
    if (isObject(value)) addMissingLeaves(edits, current, path, value)
    else {
      const safe = safeValue(value)
      if (safe !== undefined) edits.push({ keyPath: path, value: safe })
    }
  }
}

const modelEdits = (
  edits: ConfigEdit[],
  current: ConfigObject,
  model: Record<string, unknown> | null,
  path: string[],
) => {
  if (!model) return
  const providerID = typeof model.providerID === "string" ? model.providerID : undefined
  const id = typeof model.id === "string" ? model.id : undefined
  const variant = typeof model.variant === "string" ? model.variant : undefined
  if (id && atPath(current, path) === undefined) edits.push({ keyPath: path, value: id })
  if (providerID && path.length === 1 && path[0] === "model" && atPath(current, ["model_provider"]) === undefined) {
    edits.push({ keyPath: ["model_provider"], value: providerID })
  }
  if (variant && path.length === 1 && path[0] === "model" && atPath(current, ["model_reasoning_effort"]) === undefined) {
    edits.push({ keyPath: ["model_reasoning_effort"], value: variant })
  }
}

export class ConfigMigrationService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: ConfigMigrationRepository,
    private readonly legacyAppearanceSettingsPath?: string | null,
    private readonly legacyToolingSettingsPath?: string | null,
  ) {}

  async run() {
    const legacy = this.repository.read()
    if (legacy.completed) return
    const read = await this.config.read({ includeLayers: true })
    const current = read.layers?.find((layer) => layer.kind === "user")?.config ?? {}
    const userVersion = read.layers?.find((layer) => layer.kind === "user")?.version
    const edits: ConfigEdit[] = []
    let migratedAppearance = false
    let migratedTooling = false
    if (this.legacyAppearanceSettingsPath) {
      try {
        const appearance = JSON.parse(
          await readFile(this.legacyAppearanceSettingsPath, "utf8"),
        ) as unknown
        if (isObject(appearance)) {
          addMissingLeaves(edits, current, ["desktop", "appearance"], appearance)
          migratedAppearance = true
        }
      } catch {}
    }
    if (this.legacyToolingSettingsPath) {
      try {
        const tooling = JSON.parse(
          await readFile(this.legacyToolingSettingsPath, "utf8"),
        ) as unknown
        if (isObject(tooling) && isObject(tooling.preferences)) {
          addMissingLeaves(
            edits,
            current,
            ["desktop", "tooling"],
            tooling.preferences,
          )
          migratedTooling = true
        }
      } catch {}
    }
    if (legacy.desktop) {
      addLegacyDesktopEdits(edits, current, legacy.desktop)
    }
    modelEdits(edits, current, legacy.defaultModel, ["model"])
    modelEdits(edits, current, legacy.reviewerModel, ["task_models", "reviewer"])
    for (const provider of legacy.providerSettings) {
      const safe = safeValue(provider.payload)
      if (isObject(safe)) {
        addMissingLeaves(edits, current, ["model_providers", provider.providerID], safe)
      }
    }
    const legacyMcpUser = isObject(legacy.mcp?.user)
      ? legacy.mcp.user as Record<string, unknown>
      : {}
    for (const [name, declaration] of Object.entries(legacyMcpUser)) {
      if (isObject(declaration)) {
        addMissingLeaves(
          edits,
          current,
          ["mcp_servers", name],
          declaration,
        )
      }
    }
    const legacyMcpLocal = isObject(legacy.mcp?.local)
      ? legacy.mcp.local as Record<string, unknown>
      : {}
    const projectHashes = new Set(legacy.projects.map((project) =>
      createHash("sha256")
        .update(project.rootPath.toLowerCase())
        .digest("hex")))
    for (const [hash, servers] of Object.entries(legacyMcpLocal)) {
      if (projectHashes.has(hash) || !isObject(servers)) continue
      addMissingLeaves(
        edits,
        current,
        ["migration", "unresolved_mcp", hash],
        servers,
      )
    }
    const disabledSkillHashes = Array.isArray(legacy.skills?.disabledPathHashes)
      ? legacy.skills.disabledPathHashes.filter((value): value is string =>
          typeof value === "string")
      : []
    if (
      disabledSkillHashes.length
      && atPath(current, ["migration", "unresolved_skills"]) === undefined
    ) {
      edits.push({
        keyPath: ["migration", "unresolved_skills"],
        value: disabledSkillHashes,
      })
    }
    if (edits.length > 0) {
      await this.config.batchWrite({
        edits,
        ...(userVersion ? { expectedVersion: userVersion } : {}),
      })
      const verified = await this.config.read()
      if (verified.diagnostics.some((item) => item.severity === "error")) {
        throw new Error("config.toml migration verification failed")
      }
    }
    for (const project of legacy.projects) {
      const projectFile = join(project.rootPath, ".codepilotx", "config.toml")
      const projectRead = await this.config.read({
        includeLayers: true,
        cwd: project.rootPath,
      })
      const existingProject = projectRead.layers?.find(
        (layer) => layer.kind === "project",
      )?.config ?? {}
      const projectEdits: ConfigEdit[] = []
      modelEdits(
        projectEdits,
        existingProject,
        project.defaultModel,
        ["model"],
      )
      const projectHash = createHash("sha256")
        .update(project.rootPath.toLowerCase())
        .digest("hex")
      const projectMcp = legacyMcpLocal[projectHash]
      if (isObject(projectMcp)) {
        for (const [name, declaration] of Object.entries(projectMcp)) {
          if (isObject(declaration)) {
            addMissingLeaves(
              projectEdits,
              existingProject,
              ["mcp_servers", name],
              declaration,
            )
          }
        }
      }
      if (projectEdits.length) {
        await this.config.batchWrite({
          edits: projectEdits,
          filePath: projectFile,
          migrationScope: "project",
        })
      }
    }
    const runtimeState = Object.fromEntries(
      Object.entries(legacy.desktop ?? {}).filter(([key]) => DESKTOP_RUNTIME_KEYS.has(key)),
    )
    const mcpRuntime = legacy.mcp
      ? { ...legacy.mcp, user: {}, local: {} }
      : null
    this.repository.commit(runtimeState, mcpRuntime, legacy.skills)
    if (migratedAppearance && this.legacyAppearanceSettingsPath) {
      await rm(this.legacyAppearanceSettingsPath, { force: true })
    }
    if (migratedTooling && this.legacyToolingSettingsPath) {
      await rm(this.legacyToolingSettingsPath, { force: true })
    }
  }
}
