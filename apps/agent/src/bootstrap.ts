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
import { SubagentService } from "./subagent/SubagentService"
import { SubagentWorkspaceCoordinator } from "./subagent/SubagentWorkspaceCoordinator"
import { AttachmentService } from "./subagent/AttachmentService"
import { SqliteAttachmentCatalog } from "./subagent/SqliteAttachmentCatalog"
import { MemoryService } from "./memory/MemoryService"
import { secretScrubber } from "./security/SecretScrubber"
import { HookService } from "./hooks/HookService"
import { WorkspaceService } from "./workspace/WorkspaceService"
import { generateObject } from "ai"
import { z } from "zod"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
  let toolExecutor!: ToolExecutor
  const hooks = new HookService(db, {
    run: async (input) => {
      if (!input.threadID || !input.turnID) throw new Error("Hook command 缺少 thread/turn 上下文")
      const projectID = db.threadProjectID(input.threadID)
      const project = projectID ? db.getProject(projectID) : null
      const turn = db.getTurnInput(input.turnID)
      if (!project || !turn) throw new Error("Hook command 无法解析工作区或权限快照")
      const workspace = await WorkspaceService.open(project.rootPath)
      const evidenceDir = await mkdtemp(join(tmpdir(), "codepilotx-hook-evidence-"))
      const evidencePath = join(evidenceDir, "evidence.json")
      await writeFile(evidencePath, input.evidence, "utf8")
      const quotedEvidencePath = evidencePath.replaceAll("'", "''")
      try {
        const result = await toolExecutor.execute<{ stdout: string; stderr: string }>("shell", {
          command: `Get-Content -Raw -LiteralPath '${quotedEvidencePath}' | & { ${input.command} }`,
          timeoutMs: input.timeoutMs,
          justification: `执行 Hook ${input.hookID}`,
        }, {
          threadID: input.threadID,
          turnID: input.turnID,
          taskMode: turn.taskMode,
          signal: new AbortController().signal,
          workspace,
          permissionConfig: turn.permissionConfig,
          model: turn.model,
          taskSummary: `Hook ${input.hookID}`,
          skipHooks: true,
        })
        return { output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim() }
      } finally {
        await rm(evidenceDir, { recursive: true, force: true }).catch(() => undefined)
      }
    },
  }, (value) => secretScrubber.scrubText(value), async (event) => { await Effect.runPromise(hub.publish(event)) })
  toolExecutor = new ToolExecutor(tools, {
    dataDir: config.dataDir,
    sandbox,
    helperPath: config.srtWinPath,
    authorizeShell: (invocation, signal) => approvals.authorize(invocation, signal),
    recordToolCall: (invocation, status, output, error, startedAt) => db.upsertToolCall(invocation, status, output, error, startedAt),
    prepareSandboxEscalation: (invocation, failure) => approvals.prepareSandboxEscalation(invocation, failure),
    claimSandboxEscalation: (token, scope) => approvals.claimSandboxEscalation(token, scope),
    completeSandboxEscalation: (token, output) => approvals.completeSandboxEscalation(token, output),
    hooks,
  })
  const questions = new QuestionService(db, hub)
  const orchestrator = new AgentOrchestrator({
    db,
    hub,
    toolExecutor,
    sessionFor: (sessionID) => new SqliteAgentSession(db, sessionID),
  })
  const attachments = yield* Effect.promise(() => AttachmentService.open(config.dataDir, { catalog: new SqliteAttachmentCatalog(db) }))
  const memory = new MemoryService(db, {
    enabled: () => db.getSetting<Record<string, unknown>>("desktop.settings.v1")?.enableMemory === true,
    scrub: (value) => secretScrubber.scrubText(value),
    extractor: {
      extract: async ({ transcript, projectKey, signal }) => {
        const ref = db.getSetting<Model.Ref>("defaultModel")
        if (!ref) return []
        const model = await providers.getLanguage(ref)
        const { object } = await generateObject({
          model,
          ...(signal ? { abortSignal: signal } : {}),
          schema: z.object({ memories: z.array(z.object({ scope: z.enum(["user", "project"]), content: z.string().min(1).max(2_000) })).max(10) }),
          schemaName: "local_memory_extraction",
          system: "从对话中只提炼长期稳定、未来有用的偏好或项目事实。不要保存凭据、临时错误、完整对话或大段源码。无法确定时返回空数组。",
          prompt: `<untrusted_transcript project=${JSON.stringify(projectKey)}>${transcript}</untrusted_transcript>`,
        })
        return object.memories
      },
    },
  })
  const subagentWorkspaces = new SubagentWorkspaceCoordinator(db, config.dataDir)
  const subagents = new SubagentService(db, hub, providers, approvals, questions, orchestrator, attachments, subagentWorkspaces, config.dataDir, memory, hooks)
  const threads = new ThreadService(db, hub, providers, approvals, questions, orchestrator, subagents, attachments, config.dataDir, memory, hooks)
  const history = new ThreadHistoryService(db, hub)
  const app = createApp({ config, db, hub, threads, history, approvals, questions, subagents, attachments, providers, integrations, memory, hooks, logger, sandbox })
  return { config, db, app, logger, providers, sandbox }
})
