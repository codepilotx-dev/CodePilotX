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

export const loadConfig = Effect.sync((): AgentConfig => {
  const dataDir = resolveAgentDataDirectory()
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
    logDir: resolveAgentLogDirectory(),
    historyDatabasePath: resolve(dataDir, "history.sqlite"),
    profileDatabasePath: resolve(dataDir, "profile.sqlite"),
    legacyDatabasePath: resolve(dataDir, "agent.sqlite"),
    modelSnapshotPath: snapshot,
    modelCachePath: resolve(dataDir, "models.cache.json"),
    srtWinPath: process.env.CODEPILOTX_SRT_WIN_PATH ? resolve(process.env.CODEPILOTX_SRT_WIN_PATH) : null,
    rendererDir: process.env.CODEPILOTX_RENDERER_DIST ? resolve(process.env.CODEPILOTX_RENDERER_DIST) : process.env.CODEPILOTX_STATIC_DIR ? resolve(process.env.CODEPILOTX_STATIC_DIR) : process.env.CODEPILOTX_RENDERER_DIR ? resolve(process.env.CODEPILOTX_RENDERER_DIR) : null,
    rendererDevURL: process.env.CODEPILOTX_RENDERER_DEV_URL ?? process.env.CODEPILOTX_RENDERER_URL ?? null,
    modelsDevURL: process.env.CODEPILOTX_MODELS_URL ?? "https://models.dev",
    petsDir: resolveAgentPetsDirectory(),
    legacyDataDir: process.env.CODEPILOTX_LEGACY_DATA_DIR?.trim()
      ? resolve(process.env.CODEPILOTX_LEGACY_DATA_DIR)
      : null,
    legacyPetsDir: process.env.CODEX_HOME?.trim()
      ? resolve(process.env.CODEX_HOME, "pets")
      : null,
  }
})
