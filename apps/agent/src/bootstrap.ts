import { Effect } from "effect";
import type { Model } from "@codepilotx/model-schema";
import {
  createBuiltinProviderPlugins,
  createPluginHost,
} from "@codepilotx/provider-plugin";
import { loadConfig } from "./config/Config";
import { ConfigService } from "./config/ConfigService";
import { ConfigMigrationService } from "./config/ConfigMigrationService";
import { ConfigMigrationRepository } from "./storage/repositories/config-migration-repository";
import { AgentDatabase } from "./storage/database/AgentDatabase";
import { EventHub } from "./storage/events/EventHub";
import { publishAgentEvent } from "./storage/events/EventPublisher";
import { EncryptedCredentialRepository } from "./auth/EncryptedCredentialRepository";
import { ToolRegistry } from "./tool/ToolRegistry";
import { ToolExecutor } from "./tool/ToolExecutor";
import { getToolingManager } from "./tool/ToolingManager";
import { ApprovalService } from "./permission/ApprovalService";
import { ReviewerService } from "./permission/ReviewerService";
import { QuestionService } from "./session/QuestionService";
import { ThreadService } from "./session/ThreadService";
import { ThreadHistoryService } from "./session/ThreadHistoryService";
import { PiOrchestratorAdapter } from "./orchestration/PiOrchestratorAdapter";
import { PiModelService } from "./provider/pi";
import { PiModelCatalogAdapter } from "./provider/PiModelCatalogAdapter";
import { generatePiObject } from "./provider/pi/PiStructuredOutput";
import { createApp } from "./transport/server";
import { AgentLogger } from "./observability/AgentLogger";
import { ExecutionLogObserver, HarnessLogObserver } from "./observability/ExecutionLogObserver";
import { IntegrationService } from "./provider/IntegrationService";
import { ApiKeyService } from "./provider/ApiKeyService";
import { SubagentService } from "./subagent/SubagentService";
import { SubagentWorkspaceCoordinator } from "./subagent/SubagentWorkspaceCoordinator";
import { AttachmentService } from "./subagent/AttachmentService";
import { SqliteAttachmentCatalog } from "./subagent/SqliteAttachmentCatalog";
import { ProjectSourceService } from "./project/ProjectSourceService";
import { ProjectService } from "./project/ProjectService";
import { MemoryService } from "./memory/MemoryService";
import { secretScrubber } from "./security/SecretScrubber";
import { HookService } from "./hooks/HookService";
import { z } from "zod";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { GitReviewService } from "./review/GitReviewService";
import { GithubService } from "./github/GithubService";
import type { Models } from "@earendil-works/pi-ai";
import { ManagedProjectlessWorkspaceService } from "./workspace/ManagedProjectlessWorkspaceService";
import { ThreadWorkspaceResolver } from "./workspace/ThreadWorkspaceResolver";
import { PetService } from "./pet/PetService";
import { ReleaseNotesService } from "./release-notes/ReleaseNotesService";
import {
  migrateLegacyAgentData,
  relocateAgentDataRoot,
} from "./config/DataDirectoryMigration";
import { SkillManagementService } from "./prompt/SkillManagementService";
import { SkillSettingsRepository } from "./storage/repositories/skill-settings-repository";
import { McpSettingsRepository } from "./storage/repositories/mcp-settings-repository";
import { McpConfigService } from "./mcp/McpConfigService";
import { McpConnectionManager } from "./mcp/McpConnectionManager";
import { McpRuntimeService } from "./mcp/McpRuntimeService";
import { McpDiagnosticContextProvider } from "./mcp/McpDiagnosticContextProvider";
import { McpClientFactory } from "./mcp/McpClientFactory";
import { McpOAuthCredentialRepository } from "./mcp/McpOAuthCredentialRepository";
import { McpOAuthCoordinator } from "./mcp/McpOAuthCoordinator";
import { McpOAuthService } from "./mcp/McpOAuthService";
import { ThreadProjection } from "./transport/ThreadProjection";
import { TaskSuggestionService } from "./suggestion/TaskSuggestionService";
import { UsageService } from "./usage/UsageService";
import { UsageRepository } from "./storage/repositories/usage-repository";

export interface BootstrapOptions {
  models?: Models;
  initializeDatabase?: (db: AgentDatabase) => void;
}

export const createBootstrap = (options: BootstrapOptions = {}) =>
  Effect.gen(function* () {
    const config = yield* loadConfig;
    if (config.relocationSourceDir && config.relocationOperationId) {
      yield* Effect.promise(() =>
        relocateAgentDataRoot({
          sourceDir: config.relocationSourceDir!,
          targetDir: config.dataDir,
          operationId: config.relocationOperationId!,
        }),
      );
    }
    yield* Effect.promise(() =>
      migrateLegacyAgentData({
        dataDir: config.dataDir,
        legacyDataDir: config.legacyDataDir,
        legacyPetsDir: config.legacyPetsDir,
      }),
    );
    const logger = new AgentLogger(config.logDir);
    const db = new AgentDatabase({
      historyPath: config.historyDatabasePath,
      profilePath: config.profileDatabasePath,
      legacyPath: config.legacyDatabasePath,
    });
    options.initializeDatabase?.(db);
    const configService = new ConfigService(config.storage.userConfig);
    yield* Effect.promise(() => configService.initialize());
    yield* Effect.promise(() =>
      new ConfigMigrationService(
        configService,
        new ConfigMigrationRepository(db),
        config.legacyAppearanceSettingsPath,
        join(config.storage.toolingRoot, "v2", "settings.json"),
      ).run(),
    );
    const projectlessWorkspaces = new ManagedProjectlessWorkspaceService(
      config.documentsDir,
    );
    const workspaceResolver = new ThreadWorkspaceResolver(
      db,
      projectlessWorkspaces,
    );
    const hub = yield* EventHub.make;
    const unsubscribeConfig = configService.subscribe(async (event) => {
      await publishAgentEvent(db, hub, null, null, "config/updated", {
        version: event.version,
        changedKeyPaths: event.changedKeyPaths,
        scope: event.scope,
        diagnostics: event.diagnostics.map(({ severity, code, message }) => ({
          severity,
          code,
          message,
        })),
      });
    });
    const executionLogs = new ExecutionLogObserver(logger);
    const unsubscribeExecutionLogs = hub.listen((signal) =>
      executionLogs.observeSignal(signal),
    );
    const harnessLogs = new HarnessLogObserver(logger);
    const desktopSettings = configService.snapshot().desktop as Record<string, unknown> | undefined;
    const configuredTooling = desktopSettings?.tooling && typeof desktopSettings.tooling === "object"
      && !Array.isArray(desktopSettings.tooling)
      ? desktopSettings.tooling as Record<string, unknown>
      : {};
    const configuredToolingPreferences = Object.fromEntries(
      ["nodejs", "python", "git-bash", "ripgrep"].flatMap((id) => {
        const preference = configuredTooling[id];
        return preference === "managed" || preference === "system"
          ? [[id, preference]]
          : [];
      }),
    );
    const legacyToolingPreference =
      desktopSettings?.workspaceDependenciesMigrated === true
        ? undefined
        : typeof desktopSettings?.installCodePilotXDependencies === "boolean"
          ? desktopSettings.installCodePilotXDependencies
          : undefined;
    const toolingPreferences = Object.keys(configuredToolingPreferences).length > 0
      ? configuredToolingPreferences
      : legacyToolingPreference === undefined
        ? {}
        : {
            nodejs: legacyToolingPreference ? "managed" : "system",
            python: legacyToolingPreference ? "managed" : "system",
          };
    const tooling = getToolingManager(
      legacyToolingPreference === undefined
        ? {
            root: config.storage.toolingRoot,
            preferences: toolingPreferences,
            persistPreferences: false,
          }
        : {
            root: config.storage.toolingRoot,
            legacyInstallCodePilotXDependencies: legacyToolingPreference,
            preferences: toolingPreferences,
            persistPreferences: false,
          },
    );
    const pets = new PetService(config.petsDir);
    const skills = new SkillManagementService(
      new SkillSettingsRepository(db),
      { dataRoot: config.dataDir, userHome: homedir() },
      configService,
    );
    const unsubscribeTooling = tooling.subscribe((status) => {
      void publishAgentEvent(
        db,
        hub,
        null,
        null,
        "tooling/updated",
        { status },
      ).catch((cause) =>
        logger.warn("tooling.status.publish.failed", {
          id: status.id,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    });
    void tooling.refreshStatuses().catch(() =>
      logger.warn("tooling.status.warmup.failed", {
        error: "TOOLING_WARMUP_FAILED",
      }),
    );
    const credentials = new EncryptedCredentialRepository(db);
    yield* credentials.validateAll();
    yield* credentials.backfillApiKeyMetadata();
    const github = new GithubService(credentials, {
      getConfiguredClientId: () => config.githubOAuthClientId,
      getBrokerURL: () => config.githubAuthBrokerURL,
      getCallbackURL: () =>
        config.port > 0
          ? `http://127.0.0.1:${config.port}/auth/github/callback`
          : null,
    });
    const releaseNotes = new ReleaseNotesService();
    const review = new GitReviewService(
      db,
      async (projectId) => {
        await publishAgentEvent(db, hub, null, null, "workspace/git/changed", {
          projectId,
          changedAt: Date.now(),
        });
      },
      (input) => github.preparePullRequestComparison(input),
    );
    const pluginHost = createPluginHost({
      builtins: createBuiltinProviderPlugins(),
    });
    yield* pluginHost.init();
    const piModels = new PiModelService(credentials, {
      ...(options.models ? { models: options.models } : {}),
      config: () => ({
        providers: Object.fromEntries(
          Object.entries(
            (configService.snapshot().model_providers as Record<string, Record<string, unknown>> | undefined)
              ?? {},
          ),
        ),
      }),
    });
    const providers = new PiModelCatalogAdapter(piModels);
    const integrations = new IntegrationService(
      providers,
      pluginHost,
      credentials,
    );
    const apiKeys = new ApiKeyService(
      piModels,
      integrations,
      credentials,
    );
    yield* Effect.promise(async () => {
      await providers.models();
      await integrations.list();
      await providers.reload();
    });
    const tools = new ToolRegistry();
    const mcpConfigs = new McpConfigService(
      new McpSettingsRepository(db),
      configService,
    );
    const usage = new UsageService(
      new UsageRepository(db),
      providers,
      integrations,
      credentials,
    );
    const mcpOAuthCoordinator = new McpOAuthCoordinator(
      new McpOAuthCredentialRepository(credentials),
      `http://127.0.0.1:${config.port}/auth/mcp/callback`,
    );
    const mcpConnections = new McpConnectionManager(
      mcpConfigs,
      tools,
      new McpClientFactory(mcpOAuthCoordinator),
      async (generation) => {
        await publishAgentEvent(db, hub, null, null, "mcp/updated", {
          generation,
        });
      },
      new McpDiagnosticContextProvider(new ThreadProjection(db)),
      mcpOAuthCoordinator,
    );
    const mcpOAuth = new McpOAuthService(
      mcpConfigs,
      mcpConnections,
      mcpOAuthCoordinator,
    );
    const mcp = new McpRuntimeService(mcpConfigs, mcpConnections, mcpOAuth);
    const reviewer = new ReviewerService(db, piModels, configService);
    const approvals = new ApprovalService(
      db,
      hub,
      tools,
      (invocation, signal) => reviewer.review(invocation, signal),
    );
    let toolExecutor!: ToolExecutor;
    const hooks = new HookService(
      db,
      {
        run: async (input) => {
          if (!input.threadID || !input.turnID)
            throw new Error("Hook command 缺少 thread/turn 上下文");
          const turn = db.getTurnInput(input.turnID);
          if (!turn) throw new Error("Hook command 无法解析权限快照");
          const runtime = await workspaceResolver.resolve(input.threadID);
          const workspace = runtime.workspace;
          const evidenceDir = await mkdtemp(
            join(tmpdir(), "codepilotx-hook-evidence-"),
          );
          const evidencePath = join(evidenceDir, "evidence.json");
          await writeFile(evidencePath, input.evidence, "utf8");
          const quotedEvidencePath = evidencePath.replaceAll("'", "''");
          try {
            const result = await toolExecutor.execute<{
              stdout: string;
              stderr: string;
            }>(
              "PowerShell",
              {
                command: `Get-Content -Raw -LiteralPath '${quotedEvidencePath}' | & { ${input.command} }`,
                timeout: input.timeoutMs,
                description: `执行 Hook ${input.hookID}`,
              },
              {
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
              },
            );
            return {
              output:
                `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim(),
            };
          } finally {
            await rm(evidenceDir, { recursive: true, force: true }).catch(
              () => undefined,
            );
          }
        },
      },
      (value) => secretScrubber.scrubText(value),
      async (event) => {
        await Effect.runPromise(hub.publish(event));
      },
      configService,
    );
    toolExecutor = new ToolExecutor(tools, {
      dataDir: config.dataDir,
      userConfigPath: config.storage.userConfig,
      validateConfigDocument: (text, scope) =>
        configService.validateDocument(text, scope),
      resolveTooling: (id, resolveOptions) =>
        tooling.resolve(id, resolveOptions),
      resolveToolingEnvironment: (required, resolveOptions) =>
        tooling.resolveEnvironment(required, resolveOptions),
      authorizeShell: (invocation, signal) =>
        approvals.authorize(invocation, signal),
      recordToolCall: (invocation, status, output, error, startedAt) =>
        db.upsertToolCall(invocation, status, output, error, startedAt),
      completedToolCall: (toolCallID) => db.completedToolCall(toolCallID),
      logger,
      hooks,
      fileSaved: ({ workspaceRoot, filePath }) =>
        configService.notifyFileSaved(workspaceRoot, filePath),
    });
    const questions = new QuestionService(db, hub);
    const orchestrator = new PiOrchestratorAdapter({
      db,
      hub,
      models: piModels.pi,
      toolExecutor,
      observeHarnessEvent: (context, event) =>
        harnessLogs.observe({
          threadId: context.threadID,
          turnId: context.turnID,
          agentId: context.agentID,
        }, event),
    });
    const attachments = yield* Effect.promise(() =>
      AttachmentService.open(config.dataDir, {
        catalog: new SqliteAttachmentCatalog(db),
      }),
    );
    const projectSources = yield* Effect.promise(() =>
      ProjectSourceService.open(config.dataDir, db),
    );
    yield* Effect.promise(() =>
      new ProjectService(db, projectSources).recoverPendingRemovals(),
    );
    const memory = new MemoryService(db, {
      enabled: () =>
        (configService.snapshot().features as Record<string, unknown> | undefined)
          ?.memory === true
        || (configService.snapshot().desktop as Record<string, unknown> | undefined)
          ?.enableMemory === true,
      scrub: (value) => secretScrubber.scrubText(value),
      extractor: {
        extract: async ({ transcript, projectKey, signal }) => {
          const currentConfig = configService.snapshot();
          const modelID = typeof currentConfig.model === "string" ? currentConfig.model : undefined;
          const providerID = typeof currentConfig.model_provider === "string" ? currentConfig.model_provider : undefined;
          const ref = modelID && providerID
            ? { providerID, id: modelID } as Model.Ref
            : null;
          if (!ref) return [];
          const model = await piModels.getPiModel(ref);
          const object = await generatePiObject({
            models: piModels.pi,
            model,
            ...(signal ? { signal } : {}),
            schema: z.object({
              memories: z
                .array(
                  z.object({
                    scope: z.enum(["user", "project"]),
                    content: z.string().min(1).max(2_000),
                  }),
                )
                .max(10),
            }),
            schemaName: "local_memory_extraction",
            system:
              "从对话中只提炼长期稳定、未来有用的偏好或项目事实。不要保存凭据、临时错误、完整对话或大段源码。无法确定时返回空数组。",
            prompt: `<untrusted_transcript project=${JSON.stringify(projectKey)}>${transcript}</untrusted_transcript>`,
          });
          return object.memories;
        },
      },
    });
    const suggestions = new TaskSuggestionService(
      db,
      piModels,
      memory,
      logger,
      {},
      configService,
    );
    const subagentWorkspaces = new SubagentWorkspaceCoordinator(
      db,
      config.storage.workspacesRoot,
    );
    const subagents = new SubagentService(
      db,
      hub,
      providers,
      approvals,
      questions,
      orchestrator,
      attachments,
      subagentWorkspaces,
      {
        dataRoot: config.dataDir,
        userHome: homedir(),
      },
      memory,
      hooks,
      skills,
      mcpConnections,
      projectSources,
    );
    const threads = new ThreadService(
      db,
      hub,
      providers,
      approvals,
      questions,
      orchestrator,
      subagents,
      attachments,
      {
        dataRoot: config.dataDir,
        userHome: homedir(),
      },
      memory,
      hooks,
      workspaceResolver,
      review,
      skills,
      mcpConnections,
      configService,
      projectSources,
    );
    const history = new ThreadHistoryService(db, hub);
    const app = createApp({
      config,
      configService,
      db,
      hub,
      threads,
      history,
      approvals,
      questions,
      subagents,
      attachments,
      projectSources,
      providers,
      integrations,
      apiKeys,
      memory,
      hooks,
      logger,
      review,
      github,
      tooling,
      pets,
      releaseNotes,
      skills,
      mcp,
      suggestions,
      usage,
    });
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      unsubscribeExecutionLogs();
      unsubscribeTooling();
      unsubscribeConfig();
      await configService.dispose();
      await mcpConnections.dispose();
      await providers.dispose();
      await Effect.runPromise(pluginHost.dispose());
    };
    return { config, db, app, logger, providers, dispose };
  });

export const bootstrap = createBootstrap();
