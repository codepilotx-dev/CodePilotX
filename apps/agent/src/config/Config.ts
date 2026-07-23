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
}

const asPort = (value: string | undefined) => {
  const parsed = Number(value ?? "0")
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 0
}

export const loadConfig = Effect.sync((): AgentConfig => {
  const dataDir = resolve(process.env.CODEPILOTX_DATA_DIR ?? "./.codepilotx")
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
    logDir: resolve(process.env.CODEPILOTX_LOG_DIR ?? resolve(dataDir, "logs")),
    historyDatabasePath: resolve(dataDir, "history.sqlite"),
    profileDatabasePath: resolve(dataDir, "profile.sqlite"),
    legacyDatabasePath: resolve(dataDir, "agent.sqlite"),
    modelSnapshotPath: snapshot,
    modelCachePath: resolve(dataDir, "models.cache.json"),
    srtWinPath: process.env.CODEPILOTX_SRT_WIN_PATH ? resolve(process.env.CODEPILOTX_SRT_WIN_PATH) : null,
    rendererDir: process.env.CODEPILOTX_RENDERER_DIST ? resolve(process.env.CODEPILOTX_RENDERER_DIST) : process.env.CODEPILOTX_STATIC_DIR ? resolve(process.env.CODEPILOTX_STATIC_DIR) : process.env.CODEPILOTX_RENDERER_DIR ? resolve(process.env.CODEPILOTX_RENDERER_DIR) : null,
    rendererDevURL: process.env.CODEPILOTX_RENDERER_DEV_URL ?? process.env.CODEPILOTX_RENDERER_URL ?? null,
    modelsDevURL: process.env.CODEPILOTX_MODELS_URL ?? "https://models.dev",
  }
})
