import { Effect } from "effect"
import type { Model } from "@codepilotx/model-schema"
import { createBuiltinProviderPlugins, createPluginHost } from "@codepilotx/provider-plugin"
import { createProviderRuntime, type ProviderConfig } from "@codepilotx/provider-runtime"
import { loadConfig } from "./config/Config"
import { AgentDatabase } from "./storage/Database"
import { EventHub } from "./storage/EventHub"
import { EncryptedCredentialRepository } from "./auth/EncryptedCredentialRepository"
import { ToolRegistry } from "./tool/ToolRegistry"
import { ToolExecutor } from "./tool/ToolExecutor"
import { ApprovalService } from "./permission/ApprovalService"
import { ReviewerService } from "./permission/ReviewerService"
import { QuestionService } from "./session/QuestionService"
import { ThreadService } from "./session/ThreadService"
import { ThreadHistoryService } from "./session/ThreadHistoryService"
import { AgentOrchestrator } from "./orchestration/AgentOrchestrator"
import { SqliteAgentSession } from "./storage/SqliteAgentSession"
import { createApp } from "./transport/server"
import { AgentLogger } from "./observability/AgentLogger"
import { IntegrationService } from "./provider/IntegrationService"
import { AnthropicSandboxRuntimeAdapter } from "./sandbox/SandboxRuntimeAdapter"

export const bootstrap = Effect.gen(function* () {
  const config = yield* loadConfig
  const logger = new AgentLogger(config.logDir)
  const db = new AgentDatabase(config.databasePath)
  const hub = yield* EventHub.make
  const credentials = new EncryptedCredentialRepository(db)
  const pluginHost = createPluginHost({ builtins: createBuiltinProviderPlugins() })
  let integrations: IntegrationService
  const providers = createProviderRuntime({
    cachePath: config.modelCachePath,
    source: config.modelsDevURL,
    snapshot: async () => {
      const file = Bun.file(config.modelSnapshotPath)
      return await file.exists() ? await file.json() : undefined
    },
    config: () => {
      const defaultModel = db.getSetting<Model.Ref>("defaultModel")
      return {
        providers: Object.fromEntries(db.providerSettings<ProviderConfig>()),
        ...(defaultModel ? { default: defaultModel } : {}),
      }
    },
    credentials: {
      get: (providerID) => integrations.credentialSource().get(providerID),
    },
    pluginHost,
  })
  integrations = new IntegrationService(providers, pluginHost, credentials)
  yield* Effect.promise(() => providers.models().then(() => undefined))
  const tools = new ToolRegistry()
  const sandbox = new AnthropicSandboxRuntimeAdapter(config.srtWinPath)
  const reviewer = new ReviewerService(db, providers)
  const approvals = new ApprovalService(db, hub, tools, (invocation, signal) => reviewer.review(invocation, signal))
  const toolExecutor = new ToolExecutor(tools, {
    dataDir: config.dataDir,
    sandbox,
    helperPath: config.srtWinPath,
    authorizeShell: (invocation, signal) => approvals.authorize(invocation, signal),
  })
  const questions = new QuestionService(db, hub)
  const orchestrator = new AgentOrchestrator({
    db,
    hub,
    toolExecutor,
    sessionFor: (threadID, role) => new SqliteAgentSession(db, `${threadID}:${role}`),
  })
  const threads = new ThreadService(db, hub, providers, approvals, questions, orchestrator)
  const history = new ThreadHistoryService(db, hub)
  const app = createApp({ config, db, hub, threads, history, approvals, questions, providers, integrations, logger, sandbox })
  return { config, db, app, logger, providers, sandbox }
})
