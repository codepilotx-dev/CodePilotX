import { Effect } from "effect";
import type { Model } from "@codepilotx/model-schema";
import {
  createBuiltinProviderPlugins,
  createPluginHost,
  define as defineProviderPlugin,
} from "@codepilotx/provider-plugin";
import { Integration } from "@codepilotx/model-schema";
import { loadConfig } from "./config/Config";
import { AgentDatabase } from "./storage/Database";
import { EventHub } from "./storage/EventHub";
import { publishAgentEvent } from "./storage/EventPublisher";
import { EncryptedCredentialRepository } from "./auth/EncryptedCredentialRepository";
import { ToolRegistry } from "./tool/ToolRegistry";
import { ToolExecutor } from "./tool/ToolExecutor";
import { getToolingManager } from "./tool/ToolingManager";
import { createBraveSearchTool, createWebFetchTool } from "./tool/web";
import { createLspTool, LspManager } from "./lsp";
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
import { IntegrationService } from "./provider/IntegrationService";
import { AnthropicSandboxRuntimeAdapter } from "./sandbox/SandboxRuntimeAdapter";
import { SubagentService } from "./subagent/SubagentService";
import { SubagentWorkspaceCoordinator } from "./subagent/SubagentWorkspaceCoordinator";
import { AttachmentService } from "./subagent/AttachmentService";
import { SqliteAttachmentCatalog } from "./subagent/SqliteAttachmentCatalog";
import { MemoryService } from "./memory/MemoryService";
import { secretScrubber } from "./security/SecretScrubber";
import { HookService } from "./hooks/HookService";
import { WorkspaceService } from "./workspace/WorkspaceService";
import { z } from "zod";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitReviewService } from "./review/GitReviewService";
import { GithubService } from "./github/GithubService";
import type { Models } from "@earendil-works/pi-ai";

export interface BootstrapOptions {
  models?: Models;
  initializeDatabase?: (db: AgentDatabase) => void;
}

export const createBootstrap = (options: BootstrapOptions = {}) =>
  Effect.gen(function* () {
    const config = yield* loadConfig;
    const logger = new AgentLogger(config.logDir);
    const db = new AgentDatabase(config.databasePath);
    options.initializeDatabase?.(db);
    const hub = yield* EventHub.make;
    const desktopSettings = db.getSetting<Record<string, unknown>>(
      "desktop.settings.v1",
    );
    const legacyToolingPreference = desktopSettings?.workspaceDependenciesMigrated === true
      ? undefined
      : typeof desktopSettings?.installCodePilotXDependencies === "boolean"
        ? desktopSettings.installCodePilotXDependencies
        : undefined;
    const tooling = getToolingManager(
      legacyToolingPreference === undefined
        ? {}
        : { legacyInstallCodePilotXDependencies: legacyToolingPreference },
    );
    const unsubscribeTooling = tooling.subscribe((status) => {
      void publishAgentEvent(db, hub, null, null, "tooling/updated", { status })
        .catch((cause) => logger.warn("tooling.status.publish.failed", {
          id: status.id,
          error: cause instanceof Error ? cause.message : String(cause),
        }));
    });
    const credentials = new EncryptedCredentialRepository(db);
    const github = new GithubService(credentials, {
      getConfiguredClientId: () => {
        const settings = db.getSetting<Record<string, unknown>>(
          "desktop.settings.v1",
        );
        return typeof settings?.githubOAuthClientId === "string"
          ? settings.githubOAuthClientId
          : null;
      },
    });
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
    const braveSearchPlugin = defineProviderPlugin({
      id: "brave-search",
      init: ({ integration }) =>
        integration.register({
          id: Integration.ID.make("brave-search"),
          name: "Brave Search",
          methods: [{ type: "key", label: "Brave Search API Key" }],
          connections: [],
        }).pipe(Effect.asVoid),
    });
    const pluginHost = createPluginHost({
      builtins: [...createBuiltinProviderPlugins(), braveSearchPlugin],
    });
    yield* pluginHost.init();
    const piModels = new PiModelService(credentials, {
      ...(options.models ? { models: options.models } : {}),
      config: () => ({
        providers: Object.fromEntries(
          db.providerSettings<Record<string, unknown>>(),
        ),
      }),
    });
    const providers = new PiModelCatalogAdapter(piModels);
    const integrations = new IntegrationService(
      providers as never,
      pluginHost,
      credentials,
    );
    yield* Effect.promise(() => providers.models().then(() => undefined));
    const tools = new ToolRegistry();
    const lsp = new LspManager();
    tools.register(createWebFetchTool());
    tools.register(createBraveSearchTool({ credentials }));
    tools.register(createLspTool(lsp));
    const sandbox = new AnthropicSandboxRuntimeAdapter(config.srtWinPath, {
      logger,
    });
    const reviewer = new ReviewerService(db, piModels);
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
          const projectID = db.threadProjectID(input.threadID);
          const project = projectID ? db.getProject(projectID) : null;
          const turn = db.getTurnInput(input.turnID);
          if (!project || !turn)
            throw new Error("Hook command 无法解析工作区或权限快照");
          const workspace = await WorkspaceService.open(project.rootPath);
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
    );
    toolExecutor = new ToolExecutor(tools, {
      dataDir: config.dataDir,
      sandbox,
      helperPath: config.srtWinPath,
      resolveTooling: (id, resolveOptions) => tooling.resolve(id, resolveOptions),
      resolveToolingEnvironment: (required, resolveOptions) => tooling.resolveEnvironment(required, resolveOptions),
      authorizeShell: (invocation, signal) =>
        approvals.authorize(invocation, signal),
      recordToolCall: (invocation, status, output, error, startedAt) =>
        db.upsertToolCall(invocation, status, output, error, startedAt),
      completedToolCall: (toolCallID) => db.completedToolCall(toolCallID),
      prepareSandboxEscalation: (invocation, failure) =>
        approvals.prepareSandboxEscalation(invocation, failure),
      claimSandboxEscalation: (token, scope) =>
        approvals.claimSandboxEscalation(token, scope),
      completeSandboxEscalation: (token, output) =>
        approvals.completeSandboxEscalation(token, output),
      fileSaved: async ({ workspaceRoot, filePath, content }) => {
        try {
          await lsp.didChange({ rootPath: workspaceRoot, filePath, content });
          await lsp.didSave({ rootPath: workspaceRoot, filePath, content });
        } catch (cause) {
          logger.warn("lsp.file-notification.failed", {
            filePath,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      },
      hooks,
    });
    const questions = new QuestionService(db, hub);
    const orchestrator = new PiOrchestratorAdapter({
      db,
      hub,
      models: piModels.pi,
      toolExecutor,
    });
    const attachments = yield* Effect.promise(() =>
      AttachmentService.open(config.dataDir, {
        catalog: new SqliteAttachmentCatalog(db),
      }),
    );
    const memory = new MemoryService(db, {
      enabled: () =>
        db.getSetting<Record<string, unknown>>("desktop.settings.v1")
          ?.enableMemory === true,
      scrub: (value) => secretScrubber.scrubText(value),
      extractor: {
        extract: async ({ transcript, projectKey, signal }) => {
          const ref = db.getSetting<Model.Ref>("defaultModel");
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
    const subagentWorkspaces = new SubagentWorkspaceCoordinator(
      db,
      config.dataDir,
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
      config.dataDir,
      memory,
      hooks,
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
      config.dataDir,
      memory,
      hooks,
      review,
    );
    const history = new ThreadHistoryService(db, hub);
    const app = createApp({
      config,
      db,
      hub,
      threads,
      history,
      approvals,
      questions,
      subagents,
      attachments,
      providers,
      integrations,
      memory,
      hooks,
      logger,
      sandbox,
      review,
      github,
      tooling,
    });
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      unsubscribeTooling();
      await lsp.close();
      await toolExecutor.dispose();
      await sandbox.dispose();
      await providers.dispose();
      await Effect.runPromise(pluginHost.dispose());
    };
    return { config, db, app, logger, providers, sandbox, dispose };
  });

export const bootstrap = createBootstrap();
