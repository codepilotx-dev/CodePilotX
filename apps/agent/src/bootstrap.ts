import { Effect } from "effect"
import { loadConfig } from "./config/Config"
import { AgentDatabase } from "./storage/Database"
import { EventHub } from "./storage/EventHub"
import { CredentialStore } from "./auth/CredentialStore"
import { ModelCatalog } from "./provider/ModelCatalog"
import { AdapterRegistry } from "./provider/AdapterRegistry"
import { ToolRegistry } from "./tool/ToolRegistry"
import { PermissionService } from "./permission/PermissionService"
import { ReviewerService } from "./permission/ReviewerService"
import { QuestionService } from "./session/QuestionService"
import { LLMService } from "./llm/LLMService"
import { SessionProcessor } from "./session/SessionProcessor"
import { SessionService } from "./session/SessionService"
import { SessionHistoryService } from "./session/SessionHistoryService"
import { AgentOrchestrator } from "./orchestration/AgentOrchestrator"
import { SqliteAgentSession } from "./storage/SqliteAgentSession"
import { createApp } from "./transport/server"
import { AgentLogger } from "./observability/AgentLogger"

export const bootstrap = Effect.gen(function* () {
  const config = yield* loadConfig
  const logger = new AgentLogger(config.logDir)
  const db = new AgentDatabase(config.databasePath)
  const hub = yield* EventHub.make
  const credentials = new CredentialStore()
  const catalog = new ModelCatalog(config, db, async (providerID) => Boolean(await Effect.runPromise(credentials.get(providerID))))
  yield* catalog.load()
  const adapters = new AdapterRegistry(credentials)
  const tools = new ToolRegistry()
  const reviewer = new ReviewerService(db, catalog, adapters)
  const permissions = new PermissionService(db, hub, tools, (invocation, signal) => reviewer.review(invocation, signal))
  const questions = new QuestionService(db, hub)
  const llm = new LLMService(tools)
  const processor = new SessionProcessor(db, hub)
  const orchestrator = new AgentOrchestrator({
    db,
    hub,
    sessionFor: (sessionID, role) => new SqliteAgentSession(db, `${sessionID}:${role}`),
  })
  const sessions = new SessionService(db, hub, catalog, adapters, llm, processor, tools, permissions, questions, orchestrator)
  const history = new SessionHistoryService(db, hub)
  const app = createApp({ config, db, sessions, history, permissions, questions, catalog, credentials, logger })
  return { config, db, app, logger }
})
