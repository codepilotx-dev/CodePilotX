import { Effect } from "effect"
import type { Model } from "@codepilotx/model-schema"
import { createBuiltinProviderPlugins, createPluginHost } from "@codepilotx/provider-plugin"
import { createProviderRuntime, type CredentialPoolSource, type ProviderConfig } from "@codepilotx/provider-runtime"
import { loadConfig } from "./config/Config"
import { AgentDatabase } from "./storage/Database"
import { EventHub } from "./storage/EventHub"
import { publishAgentEvent } from "./storage/EventPublisher"
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
import { ApiKeyService } from "./provider/ApiKeyService"
import { AnthropicSandboxRuntimeAdapter } from "./sandbox/SandboxRuntimeAdapter"
import { SubagentService } from "./subagent/SubagentService"
import { SubagentWorkspaceCoordinator } from "./subagent/SubagentWorkspaceCoordinator"
import { AttachmentService } from "./subagent/AttachmentService"
import { SqliteAttachmentCatalog } from "./subagent/SqliteAttachmentCatalog"
import { MemoryService } from "./memory/MemoryService"
import { secretScrubber } from "./security/SecretScrubber"
import { HookService } from "./hooks/HookService"
import { generateObject } from "ai"
import { z } from "zod"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { GitReviewService } from "./review/GitReviewService"
import { GithubService } from "./github/GithubService"
import { ManagedProjectlessWorkspaceService } from "./workspace/ManagedProjectlessWorkspaceService"
import { ThreadWorkspaceResolver } from "./workspace/ThreadWorkspaceResolver"

const migrateLegacyProjectlessWorkspaces = async (db: AgentDatabase, service: ManagedProjectlessWorkspaceService) => {
  const rows = db.sqlite.query(`
    SELECT id, title, first_user_message, created_at
    FROM threads
    WHERE workspace_kind = 'legacy' AND project_id IS NULL
    ORDER BY created_at, id
  `).all() as Array<{ id: string; title: string; first_user_message: string | null; created_at: number }>
  for (const row of rows) {
    const operationID = `legacy:${createHash("sha256").update(row.id).digest("hex")}`
    const allocation = await service.allocate({
      workspaceID: crypto.randomUUID(),
      threadID: row.id,
      prompt: row.first_user_message ?? row.title,
      now: new Date(row.created_at),
    })
    try {
      const requestHash = createHash("sha256").update(JSON.stringify({ legacyThreadID: row.id })).digest("hex")
      const changed = db.sqlite.query(`
        UPDATE threads
        SET workspace_kind = 'projectless', workspace_root = ?, workspace_cwd = ?, output_directory = ?,
            create_operation_id = COALESCE(create_operation_id, ?), create_request_hash = COALESCE(create_request_hash, ?)
        WHERE id = ? AND workspace_kind = 'legacy' AND project_id IS NULL
      `).run(allocation.sessionRoot, allocation.cwd, allocation.outputDirectory, operationID, requestHash, row.id)
      if (!changed.changes) {
        await service.rollback(allocation)
        continue
      }
      await service.activate(allocation)
    } catch (cause) {
      await service.rollback(allocation).catch(() => undefined)
      throw cause
    }
  }
}

export const bootstrap = Effect.gen(function* () {
  const config = yield* loadConfig
  const logger = new AgentLogger(config.logDir)
  const db = new AgentDatabase(config.databasePath)
  const projectlessWorkspaces = new ManagedProjectlessWorkspaceService(config.documentsDir)
  yield* Effect.promise(() => migrateLegacyProjectlessWorkspaces(db, projectlessWorkspaces))
  const workspaceResolver = new ThreadWorkspaceResolver(db, projectlessWorkspaces)
  const hub = yield* EventHub.make
  const credentials = new EncryptedCredentialRepository(db)
  yield* credentials.backfillApiKeyMetadata()
  const github = new GithubService(credentials, {
    getConfiguredClientId: () => {
      const settings = db.getSetting<Record<string, unknown>>("desktop.settings.v1")
      return typeof settings?.githubOAuthClientId === "string" ? settings.githubOAuthClientId : null
    },
  })
  const review = new GitReviewService(
    db,
    async (projectId) => {
      await publishAgentEvent(db, hub, null, null, "workspace/git/changed", { projectId, changedAt: Date.now() })
    },
    (input) => github.preparePullRequestComparison(input),
  )
  const pluginHost = createPluginHost({ builtins: createBuiltinProviderPlugins() })
  let integrations: IntegrationService
  const credentialPool: CredentialPoolSource = {
    get: (providerID) => integrations.credentialSource().get(providerID),
    candidates: (providerID) => integrations.credentialSource().candidates(providerID),
    report: (outcome) => integrations.credentialSource().report(outcome),
  }
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
    credentials: credentialPool,
    pluginHost,
  })
  integrations = new IntegrationService(providers, pluginHost, credentials)
  const apiKeys = new ApiKeyService(providers, integrations, credentials)
  yield* Effect.promise(async () => {
    await providers.models()
    // ProviderRuntime 的凭据查询使用 provider ID，先通过集成目录建立
    // provider -> integration 映射，再重载一次以便重启后立即恢复存储的 Key 池。
    await integrations.list()
    await providers.reload()
  })
  const tools = new ToolRegistry()
  const sandbox = new AnthropicSandboxRuntimeAdapter(config.srtWinPath)
  const reviewer = new ReviewerService(db, providers)
  const approvals = new ApprovalService(db, hub, tools, (invocation, signal) => reviewer.review(invocation, signal))
  let toolExecutor!: ToolExecutor
  const hooks = new HookService(db, {
    run: async (input) => {
      if (!input.threadID || !input.turnID) throw new Error("Hook command 缺少 thread/turn 上下文")
      const turn = db.getTurnInput(input.turnID)
      if (!turn) throw new Error("Hook command 无法解析权限快照")
      const runtime = await workspaceResolver.resolve(input.threadID)
      const workspace = runtime.workspace
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
          defaultCwd: runtime.cwd,
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
  const threads = new ThreadService(db, hub, providers, approvals, questions, orchestrator, subagents, attachments, config.dataDir, memory, hooks, workspaceResolver, review)
  const history = new ThreadHistoryService(db, hub)
  const app = createApp({ config, db, hub, threads, history, approvals, questions, subagents, attachments, providers, integrations, apiKeys, memory, hooks, logger, sandbox, review, github })
  return { config, db, app, logger, providers, sandbox }
})
