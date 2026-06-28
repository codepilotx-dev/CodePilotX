import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CirclePause,
  FileText,
  Folder,
  FolderOpen,
  GitFork,
  Handshake,
  ListChecks,
  PlugZap,
  RefreshCcw,
  Search,
  Send,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import type {
  DesktopBackgroundTerminal,
  DesktopContextUsage,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopThreadGoal,
  DesktopWorkspace,
} from "../../../shared/types.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import { sessionDisplayTitle } from "../../uiTypes.js";
import { MarkdownMessage } from "../session/MarkdownMessage.js";
import type {
  RightDockAgentsContext,
  RightDockCollaborationContext,
  RightDockHooksContext,
  RightDockPlan,
  RightDockSessionsContext,
} from "./rightDockTools.js";

type FilesPanelProps = {
  files: DesktopFileEntry[];
  selectedFile: DesktopFilePreview | null;
  workspace: DesktopWorkspace | null;
  onPreviewFile: (file: DesktopFileEntry) => void;
};

type PlanPanelProps = {
  plan: RightDockPlan | null;
};

type GoalPanelProps = {
  goal: DesktopThreadGoal | null;
  sessionId: string | null;
  sessionStatus: string;
  loading: boolean;
  saving: boolean;
  onRefresh: () => void;
  onSave: (input: {
    objective?: string | null;
    status?: DesktopThreadGoal["status"] | null;
    tokenBudget?: number | null;
  }) => Promise<void>;
  onClear: () => Promise<void>;
};

type TerminalPanelProps = {
  sessionId: string | null;
  terminals: DesktopBackgroundTerminal[];
  loading: boolean;
  onRefresh: () => void;
  onTerminate: (processId: string) => Promise<void>;
  onClean: () => Promise<void>;
};

type TokenUsagePanelProps = {
  contextUsage: DesktopContextUsage | null;
};

export function RightDockPlanPanel({ plan }: PlanPanelProps): React.ReactNode {
  if (!plan) {
    return (
      <section className="right-dock-plan" aria-label="计划">
        <div className="right-dock-empty-state">
          <ListChecks size={58} strokeWidth={1.8} />
          <strong>暂无计划</strong>
          <span>从主对话里的计划卡片打开计划书</span>
        </div>
      </section>
    );
  }

  return (
    <section className="right-dock-plan" aria-label="计划">
      <article className="right-dock-plan-document">
        <MarkdownMessage text={plan.content} />
      </article>
    </section>
  );
}

export function RightDockGoalPanel({
  goal,
  sessionId,
  loading,
  saving,
  onRefresh,
  onSave,
  onClear,
}: GoalPanelProps): React.ReactNode {
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [status, setStatus] = useState<DesktopThreadGoal["status"]>(
    goal?.status ?? "active",
  );
  const [tokenBudget, setTokenBudget] = useState(
    goal?.tokenBudget === null || goal?.tokenBudget === undefined
      ? ""
      : String(goal.tokenBudget),
  );

  const goalSignature = `${goal?.updatedAt ?? "none"}:${goal?.objective ?? ""}:${goal?.status ?? ""}:${goal?.tokenBudget ?? ""}`;
  useEffect(() => {
    setObjective(goal?.objective ?? "");
    setStatus(goal?.status ?? "active");
    setTokenBudget(
      goal?.tokenBudget === null || goal?.tokenBudget === undefined
        ? ""
        : String(goal.tokenBudget),
    );
  }, [goalSignature]);

  if (!sessionId) {
    return (
      <section className="right-dock-plan" aria-label="目标">
        <div className="right-dock-empty-state">
          <strong>暂无活动会话</strong>
          <span>进入对话后可查看或编辑 Goal</span>
        </div>
      </section>
    );
  }

  return (
    <section className="right-dock-goal" aria-label="目标">
      <header className="right-dock-panel-header">
        <strong>Goal</strong>
        <div className="right-dock-panel-actions">
          <button
            type="button"
            onClick={onRefresh}
            title="刷新"
            disabled={loading || saving}
          >
            <RefreshCcw
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </button>
          <button
            type="button"
            onClick={() => void onClear()}
            title="清除"
            disabled={saving}
          >
            <Trash2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </button>
        </div>
      </header>
      <label className="right-dock-form-field">
        <span>Objective</span>
        <textarea
          rows={6}
          value={objective}
          placeholder="定义本会话的目标"
          onChange={(event) => setObjective(event.target.value)}
        />
      </label>
      <div className="right-dock-goal-grid">
        <label className="right-dock-form-field">
          <span>Status</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as DesktopThreadGoal["status"])
            }
          >
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="blocked">blocked</option>
            <option value="usageLimited">usageLimited</option>
            <option value="budgetLimited">budgetLimited</option>
            <option value="complete">complete</option>
          </select>
        </label>
        <label className="right-dock-form-field">
          <span>Token Budget</span>
          <input
            inputMode="numeric"
            placeholder="留空为不限"
            value={tokenBudget}
            onChange={(event) => setTokenBudget(event.target.value)}
          />
        </label>
      </div>
      {goal ? (
        <div className="right-dock-goal-stats">
          <span>已用 Token: {goal.tokensUsed}</span>
          <span>已用时长: {goal.timeUsedSeconds}s</span>
        </div>
      ) : (
        <div className="right-dock-goal-stats">
          <span>当前线程尚未设置 Goal</span>
        </div>
      )}
      <button
        className="right-dock-primary-action"
        type="button"
        disabled={saving}
        onClick={() =>
          void onSave({
            objective: objective.trim() || null,
            status,
            tokenBudget: tokenBudget.trim() ? Number(tokenBudget) : null,
          })
        }
      >
        {saving ? "保存中…" : goal ? "更新 Goal" : "创建 Goal"}
      </button>
    </section>
  );
}

export function RightDockFilesPanel({
  files,
  selectedFile,
  workspace,
  onPreviewFile,
}: FilesPanelProps): React.ReactNode {
  const [query, setQuery] = useState("");
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleFiles = useMemo(
    () => filterVisibleFiles(files, query, collapsedDirs),
    [collapsedDirs, files, query],
  );

  function toggleDirectory(path: string): void {
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <section className="right-dock-files" aria-label="打开文件">
      <div className="right-dock-file-preview">
        {selectedFile ? (
          <article className="right-dock-file-document">
            <header>
              <FileText
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
              <span title={selectedFile.path}>{selectedFile.path}</span>
            </header>
            <pre>{selectedFile.content}</pre>
            {selectedFile.truncated ? <p>文件较大，已截断预览。</p> : null}
          </article>
        ) : (
          <div className="right-dock-empty-state">
            <Folder size={58} strokeWidth={1.8} />
            <strong>打开文件</strong>
            <span>
              {workspace
                ? "从工作区目录树中选择文件"
                : "先打开一个工作区以浏览文件"}
            </span>
          </div>
        )}
      </div>
      <div className="right-dock-file-tree">
        <label className="right-dock-search">
          <Search size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <input
            aria-label="筛选文件"
            placeholder="筛选文件..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="right-dock-tree-list" role="tree">
          {visibleFiles.length > 0 ? (
            visibleFiles.map((file) => (
              <button
                className={
                  selectedFile?.path === file.path
                    ? "right-dock-tree-row active"
                    : "right-dock-tree-row"
                }
                key={file.path}
                style={{ paddingLeft: `${12 + file.depth * 18}px` }}
                title={file.path}
                type="button"
                onClick={() => {
                  if (file.type === "directory") {
                    toggleDirectory(file.path);
                    return;
                  }
                  onPreviewFile(file);
                }}
              >
                {file.type === "directory" ? (
                  collapsedDirs.has(file.path) ? (
                    <Folder size={APP_ICON_SIZE} />
                  ) : (
                    <FolderOpen size={APP_ICON_SIZE} />
                  )
                ) : (
                  <FileText size={APP_ICON_SIZE} />
                )}
                <span>{file.name}</span>
              </button>
            ))
          ) : (
            <div className="right-dock-tree-empty">
              {workspace ? "没有匹配的文件。" : "未打开工作区。"}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function RightDockSideChatPanel(): React.ReactNode {
  return (
    <section className="right-dock-side-chat" aria-label="侧边聊天">
      <div className="right-dock-side-chat-empty" />
      <div className="right-dock-side-chat-composer">
        <textarea
          aria-label="侧边聊天输入"
          disabled
          placeholder="侧边聊天将在后续版本接入"
          rows={3}
        />
        <div className="right-dock-side-chat-actions">
          <button disabled type="button">
            +
          </button>
          <button disabled type="button">
            发送
          </button>
        </div>
      </div>
    </section>
  );
}

export function RightDockTerminalPanel({
  sessionId,
  terminals,
  loading,
  onRefresh,
  onTerminate,
  onClean,
}: TerminalPanelProps): React.ReactNode {
  if (!sessionId) {
    return (
      <section className="right-dock-terminal" aria-label="终端">
        <div className="right-dock-terminal-empty">
          <SquareTerminal size={48} strokeWidth={1.6} />
          <strong>终端</strong>
          <span>进入对话后可查看后台终端</span>
        </div>
      </section>
    );
  }

  return (
    <section className="right-dock-terminal" aria-label="终端">
      <header className="right-dock-panel-header">
        <strong>后台终端</strong>
        <div className="right-dock-panel-actions">
          <button
            type="button"
            onClick={onRefresh}
            title="刷新"
            disabled={loading}
          >
            <RefreshCcw
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </button>
          <button type="button" onClick={() => void onClean()} title="清理全部">
            <Trash2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </button>
        </div>
      </header>
      <div className="right-dock-terminal-list">
        {terminals.length > 0 ? (
          terminals.map((terminal) => (
            <article
              className="right-dock-terminal-card"
              key={terminal.processId}
            >
              <header>
                <SquareTerminal
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                <strong title={terminal.command}>{terminal.command}</strong>
              </header>
              <dl>
                <div>
                  <dt>CWD</dt>
                  <dd title={terminal.cwd}>{terminal.cwd}</dd>
                </div>
                <div>
                  <dt>PID</dt>
                  <dd>{terminal.osPid ?? terminal.processId}</dd>
                </div>
                <div>
                  <dt>CPU</dt>
                  <dd>{terminal.cpuPercent ?? 0}%</dd>
                </div>
                <div>
                  <dt>RSS</dt>
                  <dd>{terminal.rssKb ?? 0} KB</dd>
                </div>
              </dl>
              <button
                className="right-dock-secondary-action"
                type="button"
                onClick={() => void onTerminate(terminal.processId)}
              >
                终止
              </button>
            </article>
          ))
        ) : (
          <div className="right-dock-terminal-empty">
            <SquareTerminal size={48} strokeWidth={1.6} />
            <strong>没有后台终端</strong>
            <span>当会话启动后台任务后会在这里出现</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function RightDockAgentsPanel({
  activeAgentId,
  agents,
  inputDisabled,
  onSelectAgent,
  onRefreshAgents,
  onSendAgentInput,
  onInterruptAgent,
  onCloseAgent,
  onResumeAgent,
  onForkAgent,
}: RightDockAgentsContext): React.ReactNode {
  const [draftByAgent, setDraftByAgent] = useState<Record<string, string>>({});
  const primaryAgents = agents.filter((agent) => agent.isPrimary);
  const subagents = agents.filter((agent) => !agent.isPrimary);

  function renderAgent(agent: RightDockAgentsContext["agents"][number]) {
    const targetId = agent.sourceThreadId ?? agent.id;
    const draft = draftByAgent[targetId] ?? "";
    const active = activeAgentId === targetId || activeAgentId === agent.id;
    return (
      <article
        className={
          active ? "right-dock-agent-card active" : "right-dock-agent-card"
        }
        key={agent.id}
      >
        <button
          className="right-dock-agent-main"
          type="button"
          onClick={() => onSelectAgent(targetId)}
        >
          <span className={`right-dock-status-dot ${agent.status}`} />
          <span className="right-dock-agent-copy">
            <strong>{agent.nickname}</strong>
            <span>{agent.role}</span>
            <small title={agent.sourceThreadId}>
              {agent.sourceThreadId ?? "当前线程"}
            </small>
          </span>
          <span className="right-dock-agent-state">{agent.status}</span>
        </button>
        <div className="right-dock-agent-input">
          <input
            value={draft}
            disabled={inputDisabled || agent.status === "closed"}
            placeholder="发送给该 agent..."
            onChange={(event) =>
              setDraftByAgent((current) => ({
                ...current,
                [targetId]: event.target.value,
              }))
            }
          />
          <button
            type="button"
            disabled={
              !draft.trim() || inputDisabled || agent.status === "closed"
            }
            title="发送"
            onClick={() => {
              const trimmed = draft.trim();
              if (!trimmed) return;
              onSendAgentInput(targetId, trimmed);
              setDraftByAgent((current) => ({ ...current, [targetId]: "" }));
            }}
          >
            <Send size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </button>
        </div>
        <div className="right-dock-inline-actions">
          <button type="button" onClick={() => onInterruptAgent(targetId)}>
            interrupt
          </button>
          {agent.status === "closed" ? (
            <button type="button" onClick={() => onResumeAgent(targetId)}>
              resume
            </button>
          ) : (
            <button type="button" onClick={() => onCloseAgent(targetId)}>
              close
            </button>
          )}
          <button
            type="button"
            onClick={() => onForkAgent(targetId, draft.trim())}
          >
            fork
          </button>
        </div>
      </article>
    );
  }

  return (
    <section className="right-dock-panel right-dock-agents" aria-label="Agents">
      <header className="right-dock-panel-header">
        <strong>Agent Picker</strong>
        <div className="right-dock-panel-actions">
          <button type="button" onClick={onRefreshAgents} title="刷新">
            <RefreshCcw
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </button>
        </div>
      </header>
      {agents.length > 0 ? (
        <div className="right-dock-section-list">
          <RightDockPanelSection title="Primary">
            {primaryAgents.length > 0 ? (
              primaryAgents.map(renderAgent)
            ) : (
              <RightDockMutedText text="暂无 primary agent" />
            )}
          </RightDockPanelSection>
          <RightDockPanelSection title="Subagents">
            {subagents.length > 0 ? (
              subagents.map(renderAgent)
            ) : (
              <RightDockMutedText text="暂无 subagent" />
            )}
          </RightDockPanelSection>
        </div>
      ) : (
        <div className="right-dock-empty-state">
          <Bot size={48} strokeWidth={1.6} />
          <strong>暂无 agent</strong>
          <span>后续主线程接线后会显示 primary 与 subagents</span>
        </div>
      )}
    </section>
  );
}

export function RightDockHooksPanel({
  entries,
  loading,
  onRefreshHooks,
  onTrustHook,
}: RightDockHooksContext): React.ReactNode {
  return (
    <section className="right-dock-panel right-dock-hooks" aria-label="Hooks">
      <header className="right-dock-panel-header">
        <strong>Hooks</strong>
        <div className="right-dock-panel-actions">
          <button
            type="button"
            onClick={onRefreshHooks}
            title="刷新"
            disabled={loading}
          >
            <RefreshCcw
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </button>
        </div>
      </header>
      {entries.length > 0 ? (
        <div className="right-dock-section-list">
          {entries.map((entry) => (
            <article className="right-dock-hook-group" key={entry.cwd}>
              <header>
                <strong title={entry.cwd}>{entry.cwd}</strong>
                <span>{entry.hooks.length} hooks</span>
              </header>
              {entry.warnings.map((warning) => (
                <p className="right-dock-warning" key={warning}>
                  {warning}
                </p>
              ))}
              {entry.errors.map((error) => (
                <p
                  className="right-dock-error"
                  key={`${error.path}:${error.message}`}
                >
                  {error.path}: {error.message}
                </p>
              ))}
              <div className="right-dock-hook-list">
                {entry.hooks.map((hook) => {
                  const canTrust =
                    hook.trustStatus === "untrusted" ||
                    hook.trustStatus === "modified";
                  return (
                    <div className="right-dock-hook-row" key={hook.key}>
                      <div>
                        <strong>{hook.eventName}</strong>
                        <span>
                          {hook.handlerType}
                          {hook.matcher ? ` · ${hook.matcher}` : ""}
                        </span>
                        <small title={hook.command ?? hook.sourcePath}>
                          {hook.command ?? hook.sourcePath}
                        </small>
                      </div>
                      <div className="right-dock-hook-status">
                        <span>{hook.trustStatus}</span>
                        {canTrust ? (
                          <button
                            type="button"
                            onClick={() =>
                              onTrustHook({
                                cwd: entry.cwd,
                                hookKey: hook.key,
                                currentHash: hook.currentHash,
                              })
                            }
                          >
                            trust
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="right-dock-empty-state">
          <PlugZap size={48} strokeWidth={1.6} />
          <strong>{loading ? "加载 Hooks..." : "暂无 Hooks"}</strong>
          <span>Hook 信任状态接线后会显示在这里</span>
        </div>
      )}
    </section>
  );
}

export function RightDockSessionsPanel({
  activeSessionId,
  sessions,
  lineage,
  onResumeSession,
  onForkSession,
}: RightDockSessionsContext): React.ReactNode {
  const entries =
    lineage.length > 0
      ? lineage
      : sessions.map((session) => ({
          id: session.id,
          title: sessionDisplayTitle(session),
          subtitle: session.summary ?? session.firstPrompt ?? null,
          cwd: session.workspacePath,
          status: session.status,
          createdAt: session.createdAt,
        }));

  return (
    <section
      className="right-dock-panel right-dock-sessions"
      aria-label="恢复/分叉"
    >
      <header className="right-dock-panel-header">
        <strong>Resume / Fork</strong>
      </header>
      {entries.length > 0 ? (
        <div className="right-dock-session-list">
          {entries.map((entry) => (
            <article
              className={
                activeSessionId === entry.id
                  ? "right-dock-session-row active"
                  : "right-dock-session-row"
              }
              key={entry.id}
            >
              <div className="right-dock-session-copy">
                <strong>{entry.title}</strong>
                {entry.subtitle ? <span>{entry.subtitle}</span> : null}
                <small title={entry.cwd ?? undefined}>
                  {[entry.status, entry.cwd, entry.createdAt]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              <div className="right-dock-inline-actions">
                <button type="button" onClick={() => onResumeSession(entry.id)}>
                  resume
                </button>
                <button type="button" onClick={() => onForkSession(entry.id)}>
                  fork
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="right-dock-empty-state">
          <GitFork size={48} strokeWidth={1.6} />
          <strong>暂无会话</strong>
          <span>会话 lineage 接线后会显示恢复与分叉入口</span>
        </div>
      )}
    </section>
  );
}

export function RightDockTokenUsagePanel({
  contextUsage,
}: TokenUsagePanelProps): React.ReactNode {
  const promptCacheHitTokens = contextUsage?.promptCacheHitTokens ?? 0;
  const promptCacheMissTokens = contextUsage?.promptCacheMissTokens ?? 0;
  const cacheTokens =
    promptCacheHitTokens +
    promptCacheMissTokens +
    (contextUsage?.cacheCreationInputTokens ?? 0) +
    (contextUsage?.cacheReadInputTokens ?? 0);

  return (
    <section
      className="right-dock-panel right-dock-token-usage"
      aria-label="Token Usage"
    >
      <header className="right-dock-panel-header">
        <strong>Token Usage</strong>
      </header>
      {contextUsage ? (
        <>
          <div className="right-dock-usage-meter">
            <div>
              <strong>{contextUsage.usedPercent}%</strong>
              <span>
                {formatCompactNumber(contextUsage.usedTokens)} /{" "}
                {formatCompactNumber(contextUsage.contextWindow)}
              </span>
            </div>
            <progress max={100} value={contextUsage.usedPercent} />
          </div>
          <dl className="right-dock-stat-grid">
            <RightDockStat
              label="Input"
              value={formatCompactNumber(contextUsage.inputTokens)}
            />
            <RightDockStat
              label="Cache"
              value={formatCompactNumber(cacheTokens)}
            />
            <RightDockStat
              label="Output"
              value={formatCompactNumber(contextUsage.outputTokens)}
            />
            <RightDockStat
              label="Reasoning"
              value={formatCompactNumber(contextUsage.reasoningTokens)}
            />
            <RightDockStat
              label="Context window"
              value={formatCompactNumber(contextUsage.contextWindow)}
            />
            <RightDockStat
              label="Remaining"
              value={`${contextUsage.remainingPercent}%`}
            />
          </dl>
          <p className="right-dock-muted-line">
            {[contextUsage.provider, contextUsage.model]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </>
      ) : (
        <div className="right-dock-empty-state">
          <CirclePause size={48} strokeWidth={1.6} />
          <strong>暂无 Token 统计</strong>
          <span>收到模型用量事件后会复用 contextUsage 展示</span>
        </div>
      )}
    </section>
  );
}

export function RightDockCollaborationPanel({
  presets,
  selectedPresetName,
  available,
  experimental,
  onSelectPreset,
}: RightDockCollaborationContext): React.ReactNode {
  return (
    <section
      className="right-dock-panel right-dock-collaboration"
      aria-label="协作"
    >
      <header className="right-dock-panel-header">
        <strong>Collaboration</strong>
        {experimental ? (
          <span className="right-dock-panel-badge">experimental</span>
        ) : null}
      </header>
      {!available ? (
        <div className="right-dock-empty-state">
          <Handshake size={48} strokeWidth={1.6} />
          <strong>协作模式不可用</strong>
          <span>主线程接线或实验开关启用后可选择 preset</span>
        </div>
      ) : (
        <div className="right-dock-preset-list">
          {presets.map((preset) => {
            const selected = selectedPresetName === preset.name;
            return (
              <button
                className={
                  selected
                    ? "right-dock-preset-row active"
                    : "right-dock-preset-row"
                }
                key={preset.name}
                type="button"
                onClick={() => onSelectPreset(preset.name)}
              >
                <strong>{preset.name}</strong>
                <span>
                  {[
                    preset.mode ?? "default",
                    preset.model,
                    preset.reasoningEffort,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RightDockPanelSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section className="right-dock-panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function RightDockMutedText({ text }: { text: string }): React.ReactNode {
  return <p className="right-dock-muted-line">{text}</p>;
}

function RightDockStat({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactNode {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(
    value,
  );
}

function filterVisibleFiles(
  files: DesktopFileEntry[],
  query: string,
  collapsedDirs: Set<string>,
): DesktopFileEntry[] {
  const trimmedQuery = query.trim().toLowerCase();
  const hiddenPrefixes: string[] = [];
  return files.filter((file) => {
    while (
      hiddenPrefixes.length > 0 &&
      !isDescendantOf(
        file.path,
        hiddenPrefixes[hiddenPrefixes.length - 1] ?? "",
      )
    ) {
      hiddenPrefixes.pop();
    }
    if (hiddenPrefixes.some((prefix) => isDescendantOf(file.path, prefix))) {
      return false;
    }
    if (file.type === "directory" && collapsedDirs.has(file.path)) {
      hiddenPrefixes.push(file.path);
    }
    if (!trimmedQuery) return true;
    return file.path.toLowerCase().includes(trimmedQuery);
  });
}

function isDescendantOf(path: string, directoryPath: string): boolean {
  return (
    path.startsWith(`${directoryPath}/`) ||
    path.startsWith(`${directoryPath}\\`)
  );
}
