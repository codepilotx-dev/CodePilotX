import { Effect } from "effect"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { existsSync } from "node:fs"

export interface AgentConfig {
  host: string
  port: number
  authToken: string | null
  dataDir: string
  documentsDir: string
  logDir: string
  historyDatabasePath: string
  profileDatabasePath: string
  legacyDatabasePath: string
  modelSnapshotPath: string
  modelCachePath: string
  srtWinPath: string | null
  rendererDir: string | null
  rendererDevURL: string | null
  modelsDevURL: string
  petsDir: string
  legacyDataDir: string | null
  legacyPetsDir: string | null
  relocationSourceDir: string | null
  relocationOperationId: string | null
  storage: AgentStorageLayout
}

export interface AgentStorageLayout {
  dataRoot: string
  historyDatabase: string
  profileDatabase: string
  legacyDatabase: string
  modelCache: string
  hooksFile: string
  skillsRoot: string
  attachmentsRoot: string
  petsRoot: string
  toolingRoot: string
  workspacesRoot: string
  logsRoot: string
}

const asPort = (value: string | undefined) => {
  const parsed = Number(value ?? "0")
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 0
}

export const resolveAgentDataDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string =>
  resolve(
    environment.CODEPILOTX_DATA_DIR?.trim()
      || join(userHome, ".codepilotx"),
  )

export const resolveAgentLogDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string => {
  const dataDir = resolveAgentDataDirectory(environment, userHome)
  return resolve(
    environment.CODEPILOTX_LOG_DIR?.trim()
      || join(dataDir, "logs"),
  )
}

export const resolveAgentPetsDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string => {
  const dataDir = resolveAgentDataDirectory(environment, userHome)
  return resolve(
    environment.CODEPILOTX_PETS_DIR?.trim()
      || join(dataDir, "pets"),
  )
}

export const resolveAgentStorageLayout = (
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): AgentStorageLayout => {
  const dataRoot = resolveAgentDataDirectory(environment, userHome)
  return {
    dataRoot,
    historyDatabase: resolve(dataRoot, "history.sqlite"),
    profileDatabase: resolve(dataRoot, "profile.sqlite"),
    legacyDatabase: resolve(dataRoot, "agent.sqlite"),
    modelCache: resolve(dataRoot, "models.cache.json"),
    hooksFile: resolve(dataRoot, "hooks.json"),
    skillsRoot: resolve(dataRoot, "skills"),
    attachmentsRoot: resolve(dataRoot, "attachments"),
    petsRoot: resolveAgentPetsDirectory(environment, userHome),
    toolingRoot: resolve(
      environment.CODEPILOTX_TOOLING_HOME?.trim()
        || join(dataRoot, "tooling"),
    ),
    workspacesRoot: resolve(dataRoot, "workspaces"),
    logsRoot: resolveAgentLogDirectory(environment, userHome),
  }
}

export const loadConfig = Effect.sync((): AgentConfig => {
  const storage = resolveAgentStorageLayout()
  const dataDir = storage.dataRoot
  const workspaceSnapshot = resolve(import.meta.dir, "../../../../resources/models.snapshot.json")
  const snapshot = process.env.CODEPILOTX_MODEL_SNAPSHOT
    ? resolve(process.env.CODEPILOTX_MODEL_SNAPSHOT)
    : existsSync(resolve("./resources/models.snapshot.json"))
      ? resolve("./resources/models.snapshot.json")
      : workspaceSnapshot
  return {
    host: "127.0.0.1",
    port: asPort(process.env.CODEPILOTX_PORT ?? process.env.PORT),
    authToken: process.env.CODEPILOTX_AUTH_TOKEN ?? null,
    dataDir,
    documentsDir: resolve(process.env.CODEPILOTX_DOCUMENTS_DIR ?? join(homedir(), "Documents")),
    logDir: storage.logsRoot,
    historyDatabasePath: storage.historyDatabase,
    profileDatabasePath: storage.profileDatabase,
    legacyDatabasePath: storage.legacyDatabase,
    modelSnapshotPath: snapshot,
    modelCachePath: storage.modelCache,
    srtWinPath: process.env.CODEPILOTX_SRT_WIN_PATH ? resolve(process.env.CODEPILOTX_SRT_WIN_PATH) : null,
    rendererDir: process.env.CODEPILOTX_RENDERER_DIST ? resolve(process.env.CODEPILOTX_RENDERER_DIST) : process.env.CODEPILOTX_STATIC_DIR ? resolve(process.env.CODEPILOTX_STATIC_DIR) : process.env.CODEPILOTX_RENDERER_DIR ? resolve(process.env.CODEPILOTX_RENDERER_DIR) : null,
    rendererDevURL: process.env.CODEPILOTX_RENDERER_DEV_URL ?? process.env.CODEPILOTX_RENDERER_URL ?? null,
    modelsDevURL: process.env.CODEPILOTX_MODELS_URL ?? "https://models.dev",
    petsDir: storage.petsRoot,
    legacyDataDir: process.env.CODEPILOTX_LEGACY_DATA_DIR?.trim()
      ? resolve(process.env.CODEPILOTX_LEGACY_DATA_DIR)
      : null,
    legacyPetsDir: process.env.CODEX_HOME?.trim()
      ? resolve(process.env.CODEX_HOME, "pets")
      : null,
    relocationSourceDir: process.env.CODEPILOTX_RELOCATION_SOURCE_DIR?.trim()
      ? resolve(process.env.CODEPILOTX_RELOCATION_SOURCE_DIR)
      : null,
    relocationOperationId:
      process.env.CODEPILOTX_RELOCATION_OPERATION_ID?.trim() || null,
    storage,
  }
})
