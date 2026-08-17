import { Effect } from "effect";
import type { Model } from "@codepilotx/model-schema";
import { loadConfig } from "./config/Config";
import { ConfigService } from "./config/ConfigService";
import { SqliteProjectTrustStore } from "./config/ProjectTrustStore";
import { ConfigMigrationService } from "./config/ConfigMigrationService";
import { ConfigMigrationRepository } from "./storage/repositories/config-migration-repository";
import { AgentDatabase } from "./storage/database/AgentDatabase";
import { InterruptedRunRecoveryCoordinator } from "./storage/recovery/interrupted-run-recovery";
import { StartupRecoveryCoordinator } from "./storage/recovery/StartupRecoveryCoordinator";
import { EventHub } from "./storage/events/EventHub";
import { publishAgentEvent } from "./storage/events/EventPublisher";
import { EncryptedCredentialRepository } from "./auth/EncryptedCredentialRepository";
import { AuthJsonCredentialRepository } from "./auth/AuthJsonCredentialRepository";
import { ProviderCredentialStoreManager } from "./auth/ProviderCredentialStoreManager";
import { PiAuthSessionService } from "./auth/PiAuthSessionService";
import { ToolRegistry } from "./tool/ToolRegistry";
import { ToolExecutor } from "./tool/ToolExecutor";
import { getToolingManager } from "./tool/ToolingManager";
import { ApprovalService } from "./permission/ApprovalService";
import { ReviewerService } from "./permission/ReviewerService";
import { QuestionService } from "./session/QuestionService";
import { ResumeCheckpointResolver } from "./interaction/ResumeCheckpointResolver";
import { ThreadService } from "./session/ThreadService";
import { ThreadHistoryService } from "./session/ThreadHistoryService";
import { PiOrchestratorAdapter } from "./orchestration/PiOrchestratorAdapter";
import { RuntimeContributionRegistry, type RuntimeContribution } from "./runtime/RuntimeContribution";
import { ModelRequestSnapshotRecorder } from "./snapshot/RequestSnapshotRecorder";
import { PluginInstaller } from "./plugin/installer";
import { PluginService } from "./plugin/PluginService";
import { PluginRuntimeManager } from "./plugin/runtime/manager";
import { PluginContributionAdapter } from "./plugin/contributions/adapter";
import { createPluginBroker } from "./plugin/contributions/broker";
import { SystemProfileLoader } from "./plugin/system/SystemProfileLoader";
import { SystemServiceRegistry } from "./plugin/system/SystemServiceRegistry";
import { PluginRepository } from "./storage/repositories/plugin-repository";
import { ModelRequestSnapshotRepository } from "./storage/repositories/model-request-snapshot-repository";
import { RuntimeStepServiceImpl } from "./runtime/RuntimeStepService";
import { ContextCompactionService } from "./context/ContextCompactionService";
import {
  EncryptedCredentialStore,
  PiModelService,
  PiModelsFileStore,
  convertModelsDevCatalog,
} from "./provider/pi";
import { PiModelCatalogAdapter } from "./provider/PiModelCatalogAdapter";
import { generatePiObject } from "./provider/pi/PiStructuredOutput";
import { createApp } from "./transport/server";
import { AgentLogger } from "./observability/AgentLogger";
import { ExecutionLogObserver, HarnessLogObserver } from "./observability/ExecutionLogObserver";
import { normalizeShellSecurityLevel } from "./security/ShellRiskClassifier";
import { ApiKeyService } from "./provider/ApiKeyService";
import { ModelHealthService } from "./provider/ModelHealthService";
import { ProviderCredentialService } from "./provider/ProviderCredentialService";
import { SubagentService } from "./subagent/SubagentService";
import { SubagentWorkspaceCoordinator } from "./subagent/SubagentWorkspaceCoordinator";
import { AttachmentService } from "./subagent/AttachmentService";
import { SpeechTranscriptionService } from "./speech/SpeechTranscriptionService";
import { SqliteAttachmentCatalog } from "./subagent/SqliteAttachmentCatalog";
import { LocalContextPathRepository } from "./storage/repositories/local-context-path-repository";
import { LocalContextPathService } from "./local-context/LocalContextPathService";
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
import { GitWorkspaceService } from "./git/GitWorkspaceService";
import type { Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
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
import { ThreadTitleService } from "./session/ThreadTitleService";
import { UsageService } from "./usage/UsageService";
import { UsageRepository } from "./storage/repositories/usage-repository";
import { TurnPatchService } from "./patch/TurnPatchService";
import { TerminalContextService } from "./terminal/TerminalContextService";
import { TerminalOutputMirror } from "./terminal/TerminalOutputMirror";
import { createTerminalReadDefinition } from "./tool/TerminalRead/definition";
import { GitCommandRunner } from "./git/GitCommandRunner";
import {
  EnvironmentDeltaStore,
  FileProjectTrustStore,
  LocalEnvironmentDiscovery,
  LocalEnvironmentRunner,
  LocalEnvironmentService,
  LocalEnvironmentWorktreeLifecycle,
} from "./local-environment";
import { WorktreeRepository } from "./worktree/WorktreeRepository";
import { TaskExecutionBindingService } from "./worktree/TaskExecutionBindingService";
import { ManagedWorktreeService } from "./worktree/ManagedWorktreeService";
import { ThreadExecutionPreparationService } from "./worktree/ThreadExecutionPreparationService";
import { TaskboardService } from "./taskboard/TaskboardService";
import { TaskboardStartService } from "./taskboard/TaskboardStartService";
import { createTaskboardDefinitions } from "./tool/Taskboard/definitions";
import {
  BindingHandoffWorkspace,
  HandoffLifecycle,
  HandoffRepository,
  HandoffService,
  ThreadForkRepository,
} from "./handoff";
import { ConversationHistoryForkRepository } from "./session/fork/ConversationHistoryForkRepository";
import { ThreadForkWorkspaceService } from "./session/fork/ThreadForkWorkspaceService";
import { ThreadMessageForkRepository } from "./session/fork/ThreadMessageForkRepository";
import { ThreadMessageForkService } from "./session/fork/ThreadMessageForkService";
import { SideChatService } from "./session/side-chat/SideChatService";
import { SideChatEnvironmentCleanup } from "./session/side-chat/SideChatEnvironmentCleanup";

export interface BootstrapOptions {
  models?: Models;
  initializeDatabase?: (db: AgentDatabase) => void;
  onReviewGitCommand?: (args: readonly string[]) => void;
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
    const configService = new ConfigService(
      config.storage.userConfig,
      {},
      new SqliteProjectTrustStore(db),
    );
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
    const worktreeRepository = new WorktreeRepository(db.sqlite);
    const executionBindings = new TaskExecutionBindingService(worktreeRepository);
    const workspaceResolver = new ThreadWorkspaceResolver(
      db,
      projectlessWorkspaces,
      executionBindings,
    );
    const terminalContext = new TerminalContextService(workspaceResolver);
    const terminalOutput = new TerminalOutputMirror();
    const environmentDeltas = new EnvironmentDeltaStore(config.dataDir);
    const threadExecutions = new ThreadExecutionPreparationService(
      db,
      executionBindings,
      environmentDeltas,
    );
    const localEnvironmentRunner = new LocalEnvironmentRunner(environmentDeltas);
    const localEnvironment = new LocalEnvironmentService(
      new LocalEnvironmentDiscovery(new GitCommandRunner({
        maxOutputBytes: 64 * 1024,
        timeoutMs: 20_000,
      })),
      new FileProjectTrustStore(config.dataDir),
      localEnvironmentRunner,
      async (threadId) => {
        const context = await terminalContext.resolve(threadId);
        return {
          bindingId: context.bindingId,
          contextVersion: context.contextVersion,
          cwd: context.target.cwd,
          workspaceKind: context.workspaceKind,
        };
      },
    );
    const worktrees = yield* Effect.promise(() => ManagedWorktreeService.open({
      repository: worktreeRepository,
      managedRoot: join(config.dataDir, "managed-worktrees"),
      stateRoot: join(config.dataDir, "managed-worktree-state"),
      resolveProjectRoot: (projectId) => db.getProject(projectId)?.rootPath ?? null,
      environment: new LocalEnvironmentWorktreeLifecycle(localEnvironment),
      autoDeletePolicy: () => {
        const desktop = configService.snapshot().desktop as Record<string, unknown> | undefined;
        const rawLimit = desktop?.gitAutoDeleteWorktreeLimit;
        return {
          enabled: desktop?.gitAutoDeleteWorktree !== false,
          limit: typeof rawLimit === "number" && Number.isSafeInteger(rawLimit)
            ? Math.min(100, Math.max(1, rawLimit))
            : 15,
        };
      },
    }));
    const hub = yield* EventHub.make;
    const taskboard = new TaskboardService(db, hub, db.repositories.taskboard);
    const speech = new SpeechTranscriptionService(config.storage.speechRoot, async (status) => {
      await publishAgentEvent(db, hub, null, null, "speech/statusChanged", { status });
    });
    yield* Effect.promise(() => speech.initialize());
    const turnPatches = new TurnPatchService(
      db,
      hub,
      async (threadID) => (await workspaceResolver.resolve(threadID)).workspace,
    );
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
        ...(event.profileState ? { profileState: event.profileState } : {}),
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
    const providerCredentialStore = new ProviderCredentialStoreManager(
      db,
      credentials,
      new AuthJsonCredentialRepository(join(config.dataDir, "auth.json")),
      {
        read: () => {
          const value = configService.snapshot().provider_credentials
          if (!value || typeof value !== "object" || Array.isArray(value)) return null
          const store = (value as Record<string, unknown>).store
          return store === "auth-json" || store === "encrypted" ? store : null
        },
        write: async (store) => {
          await configService.batchWrite({
            edits: [{
              keyPath: ["provider_credentials", "store"],
              value: store,
            }],
          })
        },
      },
    );
    yield* providerCredentialStore.initialize();
    const github = new GithubService(credentials, {
      getConfiguredClientId: () => config.githubOAuthClientId,
      getBrokerURL: () => config.githubAuthBrokerURL,
      getCallbackURL: () =>
        config.port > 0
          ? `http://127.0.0.1:${config.port}/auth/github/callback`
          : null,
    });
    const releaseNotes = new ReleaseNotesService({
      getAccessToken: () => github.optionalAccessToken(),
    });
    const review = new GitReviewService(
      db,
      async (projectId) => {
        await publishAgentEvent(db, hub, null, null, "workspace/git/changed", {
          projectId,
          changedAt: Date.now(),
        });
      },
      (input) => github.preparedPullRequestComparison(input),
      options.onReviewGitCommand,
      logger,
    );
    const git = new GitWorkspaceService(db);

    const loadDefaultModels = async () => {
      if (options.models) return options.models;
      try {
        const client = (await import("@opencode-ai/models")).Models.make({
          baseUrl: "https://models.dev",
        });
        const catalog = await client.catalog();
        return convertModelsDevCatalog(catalog);
      } catch {
        return builtinModels({
          credentials: new EncryptedCredentialStore(credentials, {
            integrationID: () => "provider.catalog.fallback",
            providerID: () => undefined,
            oauthMethodID: () => "provider.catalog.fallback",
          }),
          authContext: {
            env: async () => undefined,
            fileExists: async () => false,
          },
        });
      }
    };
    const defaultModels = yield* Effect.promise(loadDefaultModels);
    const piModels = new PiModelService(providerCredentialStore, {
      models: defaultModels,
      modelsStore: new PiModelsFileStore(config.piModelCachePath),
      config: () => {
        const snapshot = configService.snapshot();
        const modelCatalog = snapshot.model_catalog as
          | Record<string, unknown>
          | undefined;
        const schemaVersion =
          typeof modelCatalog?.schema_version === "number"
            ? modelCatalog.schema_version
            : undefined;
        return {
          ...(schemaVersion !== undefined ? { schemaVersion } : {}),
          providers:
            (snapshot.model_providers as Record<string, unknown> | undefined)
              ?? {},
        };
      },
    });
    const providers = new PiModelCatalogAdapter(piModels);
    const modelHealth = new ModelHealthService(
      piModels,
      async (payload) => {
        await publishAgentEvent(
          db,
          hub,
          null,
          null,
          "model/health/updated",
          payload,
        );
      },
    );
    const apiKeys = new ApiKeyService(
      piModels,
      providerCredentialStore,
      modelHealth,
    );
    const providerCredentials = new ProviderCredentialService(
      piModels,
      providerCredentialStore,
    );
    const anthropicUsageModels = builtinModels({
      credentials: new EncryptedCredentialStore(credentials, {
        integrationID: () => "usage.anthropic.subscription",
        providerID: (integrationID) =>
          integrationID === "usage.anthropic.subscription"
            ? "anthropic"
            : undefined,
        oauthMethodID: () => "anthropic:oauth",
      }),
      authContext: {
        env: async () => undefined,
        fileExists: async () => false,
      },
    });
    const authSessions = new PiAuthSessionService({
      resolveTarget: (target) => {
        if (target.kind === "usage") {
          if (
            target.sourceId !== "anthropic-subscription"
            && target.sourceId !== "usage.anthropic.subscription"
          ) {
            throw new Error(`Usage OAuth source ${target.sourceId} 尚未配置`);
          }
          return { models: anthropicUsageModels, providerID: "anthropic" };
        }
        return { models: piModels.pi, providerID: target.providerId };
      },
      onUpdated: async (session) => {
        await publishAgentEvent(
          db,
          hub,
          null,
          null,
          "auth/session/updated",
          { session },
        );
      },
      onCompleted: async (target) => {
        if (target.kind === "provider") {
          await providers.reload();
          await publishAgentEvent(
            db,
            hub,
            null,
            null,
            "provider/credential/updated",
            { providerId: target.providerId },
          );
        } else {
          await publishAgentEvent(
            db,
            hub,
            null,
            null,
            "usage/source/updated",
            { sourceId: "anthropic-subscription", changedAt: Date.now() },
          );
        }
      },
    });
    yield* Effect.promise(async () => {
      await providers.models();
      await providers.reload();
    });
    const tools = new ToolRegistry();
    tools.register(createTerminalReadDefinition(terminalOutput));
    for (const definition of createTaskboardDefinitions(taskboard)) tools.register(definition);
    const mcpConfigs = new McpConfigService(
      new McpSettingsRepository(db),
      configService,
      // 插件声明的 MCP server（惰性引用 pluginContributions；用户声明优先）。
      () => pluginContributions.mcpDeclarations().map(({ name, pluginId, declaration }) => ({
        name,
        pluginId,
        declaration: declaration as never,
      })),
    );
    const usage = new UsageService(
      new UsageRepository(db),
      providers,
      piModels,
      credentials,
      {
        subscriptionModels: anthropicUsageModels,
        providerCredentials: providerCredentialStore,
      },
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
    // System permission-policy provider 替换点（PR 8B）：激活时注入决策覆盖。
    const permissionPolicyOverride = () => systemServiceRegistry.resolve<{ decide: (input: unknown) => unknown }>("codepilotx.permission-policy@1");
    const approvals = new ApprovalService(
      db,
      hub,
      tools,
      (invocation, signal) => reviewer.review(invocation, signal),
      () => {
        const provider = permissionPolicyOverride()
        if (!provider || typeof provider.decide !== "function") return null
        return { decide: (input) => provider.decide(input) as { decision: "allow" | "review" | "deny"; reason?: string } }
      },
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
      policyOverride: () => {
        const provider = permissionPolicyOverride()
        if (!provider || typeof provider.decide !== "function") return null
        return { decide: (input) => provider.decide(input) as { decision: "allow" | "review" | "deny"; reason?: string } }
      },
      resolveTooling: (id, resolveOptions) =>
        tooling.resolve(id, resolveOptions),
      resolveToolingEnvironment: (required, resolveOptions) =>
        tooling.resolveEnvironment(required, resolveOptions),
      resolveShellSecurityLevel: () =>
        normalizeShellSecurityLevel(
          configService.snapshot().shell_security_level,
        ),
      authorizeShell: (invocation, signal) =>
        approvals.authorize(invocation, signal),
      recordToolCall: (invocation, status, output, error, startedAt) =>
        db.upsertToolCall(invocation, status, output, error, startedAt),
      completedToolCall: (toolCallID) => db.completedToolCall(toolCallID),
      logger,
      hooks,
      fileSaved: ({ workspaceRoot, filePath }) =>
        configService.notifyFileSaved(workspaceRoot, filePath),
      recordMutation: (batch) =>
        Promise.resolve(db.repositories.turnPatches.recordBatch(batch)),
      discardMutationEvidence: async ({ threadID, turnID }) => {
        const events = db.repositories.turnPatches.markIncomplete(threadID, turnID)
        for (const event of events) await Effect.runPromise(hub.publish(event))
      },
    });
    const questions = new QuestionService(db, hub, false);
    // 完整 Provider 请求快照：默认关闭，只有严格布尔值 true 启用；
    // diagnostics 属于用户层配置，项目配置与 AGENTS.md 不能替用户开启。
    const runtimeSteps = new RuntimeStepServiceImpl({
      db,
      publish: async (event) => {
        await Effect.runPromise(hub.publish(event));
      },
      logger,
    });
    const requestSnapshotRepository = new ModelRequestSnapshotRepository(db);
    const requestSnapshots = new ModelRequestSnapshotRecorder({
      db,
      enabled: () => {
        const diagnostics = (configService.snapshot().diagnostics ?? {}) as Record<string, unknown>;
        const section = (diagnostics.model_request_snapshots ?? {}) as Record<string, unknown>;
        return section.enabled === true;
      },
      publish: async (event) => {
        await Effect.runPromise(hub.publish(event));
      },
      logger,
    });
    // 插件平台：Inventory/安装/启停/授权管理 service（PR 3 起装配；
    // Application runner 与 System Profile loader 在后续 PR 接入）。
    const pluginInstaller = new PluginInstaller({ root: config.storage.pluginRoot, db });
    const pluginRuntimeManager = new PluginRuntimeManager({
      db,
      installer: pluginInstaller,
      publish: async (event) => {
        await Effect.runPromise(hub.publish({
          id: 0,
          afterSequence: 0,
          threadId: null,
          turnId: null,
          method: event.method,
          params: event.params,
          createdAt: Date.now(),
        }));
      },
    });
    const pluginService = new PluginService({
      db,
      installer: pluginInstaller,
      configService,
      runtimeStatuses: () => pluginRuntimeManager.statuses(),
      onInventoryChanged: () => { void pluginRuntimeManager.reconcile() },
      contributionList: () => pluginContributions.contributionList(),
      commandExecute: (input) => pluginContributions.executeCommand(input),
      viewCall: {
        renderView: (input) => pluginContributions.renderView(input),
        viewAction: (input) => pluginContributions.viewAction(input),
      },
      publish: async (event) => {
        await Effect.runPromise(hub.publish(event));
      },
    });
    // 插件贡献适配器 + Host broker：工具/声明目录/KV/serviceCall/credentialUse。
    const pluginContributions = new PluginContributionAdapter({ db, manager: pluginRuntimeManager });
    pluginRuntimeManager.setBrokerProvider((pluginId) => createPluginBroker({
      pluginId,
      repo: new PluginRepository(db),
      manager: pluginRuntimeManager,
    }));
    // System Profile loader：boot 尝试 pending generation（失败回退 + 重启一次）。
    const systemServiceRegistry = new SystemServiceRegistry();
    const systemProfileLoader = new SystemProfileLoader(db, systemServiceRegistry, {
      // 每个 System 插件独立的 namespaced 数据根（session-persistence 等用）。
      systemDataRoot: join(config.dataDir, "system-profiles"),
    });
    const systemProfileBoot = yield* Effect.promise(() => systemProfileLoader.bootAttempt());
    // tool-runtime provider（PR 8A）：激活时把自定义工具目录叠加进 ToolRegistry。
    const toolRuntime = systemServiceRegistry.resolve<{ listTools: () => unknown[] }>("codepilotx.tool-runtime@1");
    if (toolRuntime) {
      try {
        for (const definition of toolRuntime.listTools()) {
          tools.register(definition as never);
        }
      } catch (cause) {
        logger.error("plugin.tool-runtime.invalid", { error: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    // 启动时后台 reconcile：启用的插件按 service graph 拓扑序拉起。
    void pluginRuntimeManager.reconcile();
    // 内置运行时贡献：静态注册，不加载任意本地代码。conditional 贡献沿用
    // 各自现有配置（features 区段的显式关闭优先），不新增第二套开关。
    const runtimeContributions = new RuntimeContributionRegistry((contribution) => {
      const features = (configService.snapshot().features ?? {}) as Record<string, unknown>;
      switch (contribution.manifest.id) {
        case "skills@builtin": return features.skills !== false
        case "mcp@builtin": return features.mcp !== false
        case "subagents@builtin": return features.subagents !== false
        case "plugins@builtin": return features.plugins !== false
        default: return true
      }
    });
    const registerContribution = (contribution: RuntimeContribution) => {
      runtimeContributions.register(contribution);
    };
    registerContribution({
      manifest: {
        id: "core@builtin",
        version: 1,
        displayName: "核心运行时",
        description: "注册工具、统一工具执行管线与核心编排能力。",
        provides: ["tools", "guard", "observer"],
        enablement: "required",
      },
      register: () => undefined,
    });
    registerContribution({
      manifest: {
        id: "skills@builtin",
        version: 1,
        displayName: "Skills",
        description: "通过 SkillManagementService 提供技能列表、读取与启用状态。",
        provides: ["tools", "prompt"],
        enablement: "conditional",
      },
      register: () => undefined,
    });
    registerContribution({
      manifest: {
        id: "mcp@builtin",
        version: 1,
        displayName: "MCP",
        description: "通过 McpRuntimeService 提供 MCP 服务器工具与 OAuth 连接。",
        provides: ["tools"],
        enablement: "conditional",
      },
      register: () => undefined,
    });
    registerContribution({
      manifest: {
        id: "subagents@builtin",
        version: 1,
        displayName: "子 Agent",
        description: "通过 SubagentService 提供子 Agent 派生、等待与编排。",
        provides: ["tools", "guard"],
        enablement: "conditional",
      },
      register: () => undefined,
    });
    registerContribution({
      manifest: {
        id: "plugins@builtin",
        version: 1,
        displayName: "插件",
        description: "通过 PluginContributionAdapter 提供插件工具（转发 plugin/toolExecute）与声明贡献。",
        provides: ["tools"],
        enablement: "conditional",
      },
      register: ({ builders }) => {
        pluginContributions.registerTurnContributions(builders);
      },
    });
    const orchestrator = new PiOrchestratorAdapter({
      db,
      hub,
      models: piModels.pi,
      toolExecutor,
      contextCompaction: new ContextCompactionService(db),
      contributions: runtimeContributions,
      requestSnapshot: requestSnapshots,
      runtimeSteps,
      ...(pluginRuntimeManager ? {
        pluginLeases: async (request) => pluginRuntimeManager.acquireForRequest({
          threadID: request.threadID,
          turnID: request.turnID,
          agentID: request.agentID,
          sessionID: request.sessionID,
        }),
      } : {}),
      observeHarnessEvent: (context, event) =>
        harnessLogs.observe({
          threadId: context.threadID,
          turnId: context.turnID,
          agentId: context.agentID,
        }, event),
      // System agent-loop provider（PR 8C）：激活时整轮 turn 委托给 provider。
      loopOverride: () => {
        const provider = systemServiceRegistry.resolve<{ runTurn: (input: unknown) => unknown }>("codepilotx.agent-loop@1");
        if (!provider || typeof provider.runTurn !== "function") return null;
        return {
          runTurn: (input) => provider.runTurn(input) as Promise<import("./orchestration/PiOrchestratorAdapter").AgentLoopRunOutput>,
        };
      },
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
    const sideChatEnvironmentCleanup = new SideChatEnvironmentCleanup(
      db.repositories.sideChats,
      environmentDeltas,
    );
    const localContextPaths = new LocalContextPathService(
      new LocalContextPathRepository(db),
    );
    const history = new ThreadHistoryService(
      db,
      hub,
      (threadID) => {
        return sideChatEnvironmentCleanup.prepareSource(
          threadID,
          review.prepareThreadSnapshotCleanup(threadID),
        );
      },
    );
    const threadTitles = new ThreadTitleService(
      db,
      history,
      piModels,
      logger,
      configService,
    );
    const subagentWorkspaces = new SubagentWorkspaceCoordinator(
      db,
      config.storage.workspacesRoot,
    );
    const resumeCheckpoints = new ResumeCheckpointResolver(db, approvals);
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
      resumeCheckpoints,
      false,
      localContextPaths,
      () => pluginContributions.skillBases(),
    );
    resumeCheckpoints.setResolvedSubagentWait((turnID) => subagents.resolvedWaitCheckpoint(turnID));
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
      threadTitles,
      resumeCheckpoints,
      false,
      localContextPaths,
      (threadId) => taskboard.admitPrimaryThread(threadId),
      () => pluginContributions.skillBases(),
    );
    const taskboardStart = new TaskboardStartService(
      db,
      hub,
      db.repositories.taskboard,
      threads,
      worktrees,
      threadExecutions,
    );
    const handoffOperations = new HandoffRepository(db);
    const handoff = new HandoffService(
      handoffOperations,
      new ThreadForkRepository(db),
      new BindingHandoffWorkspace(
        db,
        workspaceResolver,
        executionBindings,
        worktreeRepository,
        handoffOperations,
        environmentDeltas,
      ),
      new HandoffLifecycle(
        db,
        threads,
        async (threadId) => terminalOutput.read({ threadId }) === null,
      ),
    );
    const threadForkOperations = new ThreadMessageForkRepository(db);
    const threadFork = new ThreadMessageForkService(
      threadForkOperations,
      new ConversationHistoryForkRepository(db),
      new ThreadForkWorkspaceService(
        workspaceResolver,
        executionBindings,
        worktreeRepository,
        environmentDeltas,
      ),
      worktrees,
      worktreeRepository,
    );
    const sideChats = new SideChatService(
      db.repositories.sideChats,
      new ConversationHistoryForkRepository(db),
      new ThreadForkWorkspaceService(
        workspaceResolver,
        executionBindings,
        worktreeRepository,
        environmentDeltas,
      ),
      threads,
      executionBindings,
      (threadID) => review.prepareThreadSnapshotCleanup(threadID),
    );
    const startupRecovery = new StartupRecoveryCoordinator({
      recoverInterruptedRuns: () => new InterruptedRunRecoveryCoordinator(db).run(),
      discardRecoveredSideChats: () => sideChats.discardAll(),
      recoverResumeLeases: () => { resumeCheckpoints.recoverInterruptedLeases() },
      restoreQuestionTimers: () => questions.restoreAutoResolutions(),
      recoverSubagents: () => subagents.recoverStartup(),
      recoverHandoffs: async () => {
        for (const operationId of handoffOperations.runningOperationIDs()) await handoff.recover(operationId);
        for (const operationId of handoffOperations.pendingFinalizationIDs()) {
          const operation = handoffOperations.get(operationId);
          await handoff.acknowledgeClientTransfer(operationId, operation.revision);
        }
      },
      recoverForks: async () => {
        for (const operationId of threadForkOperations.runningOperationIDs()) await threadFork.recover(operationId);
      },
      startQueues: () => threads.startRecoveredQueues(),
    });
    yield* Effect.promise(() => startupRecovery.run());
    // 重启恢复：运行中的 step 标记 interrupted，未完成 inbox claim 释放回队列。
    yield* Effect.promise(() => runtimeSteps.recoverInterruptedSteps());
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
      localContextPaths,
      projectSources,
      providers,
      piModels,
      apiKeys,
      modelHealth,
      providerCredentials,
      providerCredentialStore,
      authSessions,
      memory,
      hooks,
      logger,
      review,
      github,
      git,
      tooling,
      pets,
      releaseNotes,
      skills,
      mcp,
      suggestions,
      usage,
      turnPatches,
      terminalContext,
      terminalOutput,
      localEnvironment,
      worktrees,
      handoff,
      threadFork,
      sideChats,
      executionBindings,
      worktreeRepository,
      environmentDeltas,
      speech,
      threadExecutions,
      taskboard,
      taskboardStart,
      runtimeContributions,
      requestSnapshots: requestSnapshotRepository,
      pluginService,
      systemServiceRegistry,
    });
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      await speech.dispose();
      unsubscribeExecutionLogs();
      unsubscribeTooling();
      unsubscribeConfig();
      await sideChats.discardAll(true);
      await pluginRuntimeManager.dispose();
      await systemProfileLoader.dispose();
      systemServiceRegistry.dispose();
      await configService.dispose();
      await mcpConnections.dispose();
      // Stop background model-health workers before tearing down the provider,
      // so no batch keeps publishing events after the database is closing.
      await modelHealth.dispose();
      await providers.dispose();
    };
    return { config, db, app, logger, providers, dispose, systemProfileBoot };
  });

export const bootstrap = createBootstrap();
