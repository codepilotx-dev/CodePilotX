import { Effect } from "effect"
import { resolve } from "node:path"
import { existsSync } from "node:fs"

export interface AgentConfig {
  host: string
  port: number
  authToken: string | null
  dataDir: string
  logDir: string
  databasePath: string
  modelSnapshotPath: string
  modelCachePath: string
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
    logDir: resolve(process.env.CODEPILOTX_LOG_DIR ?? resolve(dataDir, "logs")),
    databasePath: resolve(dataDir, "agent.sqlite"),
    modelSnapshotPath: snapshot,
    modelCachePath: resolve(dataDir, "models.cache.json"),
    rendererDir: process.env.CODEPILOTX_RENDERER_DIST ? resolve(process.env.CODEPILOTX_RENDERER_DIST) : process.env.CODEPILOTX_STATIC_DIR ? resolve(process.env.CODEPILOTX_STATIC_DIR) : process.env.CODEPILOTX_RENDERER_DIR ? resolve(process.env.CODEPILOTX_RENDERER_DIR) : null,
    rendererDevURL: process.env.CODEPILOTX_RENDERER_DEV_URL ?? process.env.CODEPILOTX_RENDERER_URL ?? null,
    modelsDevURL: process.env.CODEPILOTX_MODELS_URL ?? "https://models.dev",
  }
})
