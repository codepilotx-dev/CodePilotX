import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AppWindow,
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Columns2,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  File,
  FileDiff,
  Filter,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Laptop,
  MessageSquarePlus,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Pencil,
  Pin,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Sliders,
  SquareTerminal,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { legacyMessagesToSessionEvents } from "../../../shared/sessionEventModel.js";
import { deriveWorkflowSessionState } from "../../../shared/workflowReducer.js";
import type {
  DesktopGitStatus,
  DesktopOpenTarget,
  DesktopPermissionRequest,
  DesktopReviewView,
  DesktopSessionEvent,
  DesktopSessionStatus,
  DesktopWorkflowEvent,
} from "../../../shared/types.js";
import { useQuickChatContext } from "./QuickChatContext.js";
import { useDesktopSettings } from "../settings/useDesktopSettings.js";
import {
  buildWorkflowMarkdownReport,
  type WorkflowMarkdownLogDiagnostics,
} from "./workflowMarkdown.js";
import { buildWorkspaceCodexContextDiagnostics } from "./codexContextDiagnostics.js";
import { useHeightTransition } from "../../hooks/useHeightTransition.js";
import {
  deriveWorkflowConsistencyDiagnostics,
  workflowConsistencyIssueCount,
  type WorkflowConsistencyDiagnostics,
} from "./workflowConsistency.js";
import { desktopClient } from "../../services/desktopClient.js";
import { submitReviewAction } from "./reviewAction.js";
import { deriveReviewTurns } from "./reviewTurns.js";
import type { Message } from "../../uiTypes.js";
import { extractPlanSummary } from "./ExitPlanModeApproval.js";
import { InlineApprovalCard } from "./InlineApprovalCard.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { useTypewriterText } from "./TypewriterText.js";
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import { Tooltip } from "../../components/ui/Tooltip.js";

const FALLBACK_OPEN_TARGETS: DesktopOpenTarget[] = [
  {
    id: "default-app",
    label: "Default app",
    kind: "default-app",
  },
  {
    id: "file-explorer",
    label: "File Explorer",
    kind: "file-explorer",
  },
  {
    id: "terminal",
    label: "Terminal",
    kind: "terminal",
  },
];

function useElapsedSeconds(startTimeMs: number | undefined, isRunning: boolean): number {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    if (!isRunning || !startTimeMs) {
      setSeconds(0);
      return;
    }
    const tick = () => setSeconds(Math.floor((Date.now() - startTimeMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, startTimeMs]);
  return seconds;
}

export function ConversationPage(): React.ReactNode {
  const {
    isConversationLoading,
    activeSessionId,
    activeSessionPinnedAt,
    sessionTitle,
    events,
    workflowEvents,
    messages,
    sessionStatus,
    workspacePath,
    branchName,
    diff,
    gitStatus,
    onArchiveSession,
    onCreateBranch,
    onOpenAutomation,
    onOpenWorkspacePath,
    onRefreshDiff,
    onToggleSessionPinned,
    onCommitOrPush,
    onCreatePullRequest,
    onDecidePermission,
    onAcceptExitPlanMode,
    onOpenRightDock,
    permissionMode,
    pendingPermissions,
    composer,
    rightDockOpen,
    rightDockTool,
  } = useQuickChatContext();
  const {
    defaultOpenTargetId,
    setDefaultOpenTargetId,
    reviewView,
    model,
  } = useDesktopSettings();

  const conversationMessages = messages.filter(
    (message) => message.role !== "system",
  );
  const workflowDerivedState = React.useMemo(
    () => deriveWorkflowSessionState(workflowEvents, activeSessionId),
    [activeSessionId, workflowEvents],
  );
  const workflowConsistencyDiagnostics = React.useMemo(
    () =>
      deriveWorkflowConsistencyDiagnostics({
        activeSessionId,
        currentView: { messages },
        workflowEvents,
      }),
    [activeSessionId, messages, workflowEvents],
  );
  const timelineEvents = React.useMemo(
    () => {
      const sourceEvents =
        workflowDerivedState.events.length > 0
          ? workflowDerivedState.events
          : events.length > 0
            ? events
            : legacyMessagesToSessionEvents("legacy", conversationMessages);
      return foldTimelineEvents(sourceEvents);
    },
    [conversationMessages, events, workflowDerivedState.events],
  );
  const timelineItems = React.useMemo(
    () => groupTimelineToolEvents(timelineEvents),
    [timelineEvents],
  );
  const assistantActionMessageIds = React.useMemo(
    () =>
      deriveAssistantActionMessageIds({
        sessionStatus,
        timelineEvents,
      }),
    [sessionStatus, timelineEvents],
  );
  const showThinking = deriveWorkflowThinkingVisible({
    pendingPermissions,
    sessionStatus,
    timelineEvents,
  });
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false);
  const [openTargetMenuOpen, setOpenTargetMenuOpen] = React.useState(false);
  const [openTargets, setOpenTargets] =
    React.useState<DesktopOpenTarget[]>(FALLBACK_OPEN_TARGETS);
  const [showPinnedSummary, setShowPinnedSummary] = React.useState(true);
  const [bottomPanelVisible, setBottomPanelVisible] = React.useState(false);
  const [isRefreshingDiff, setIsRefreshingDiff] = React.useState(false);
  const handleRefreshDiff = React.useCallback(() => {
    if (isRefreshingDiff) return;
    setIsRefreshingDiff(true);
    try {
      onRefreshDiff();
    } finally {
      window.setTimeout(() => setIsRefreshingDiff(false), 600);
    }
  }, [isRefreshingDiff, onRefreshDiff]);
  const conversationMessagesForReview = React.useMemo(
    () =>
      messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          text: m.text,
          createdAt: m.createdAt,
        })),
    [messages],
  );
  const handleRunCodeReview = React.useCallback(() => {
    onOpenRightDock('review');
    onRefreshDiff();
    void submitReviewAction({
      sessionId: activeSessionId,
      gitStatus,
      diff,
      model,
    });
  }, [activeSessionId, diff, gitStatus, model, onOpenRightDock, onRefreshDiff]);
  const handleDiscardChanges = React.useCallback(
    async (paths: string[]) => {
      if (!workspacePath) return;
      if (paths.length === 0) return;
      try {
        const result = await desktopClient.discardWorkspaceChanges({
          workspacePath,
          paths,
          includeUntracked: true,
        });
        if ("error" in result) {
          window.alert(`放弃编辑失败：${result.error}`);
          return;
        }
        onRefreshDiff();
      } catch (error) {
        window.alert(
          `放弃编辑失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [onRefreshDiff, workspacePath],
  );
  const [workflowTimelineVisible, setWorkflowTimelineVisible] =
    React.useState(false);
  const showEnvironmentPanel = Boolean(
    workspacePath && showPinnedSummary && !rightDockOpen,
  );
  const showComposerChangeSummary = Boolean(
    workspacePath && gitStatus && gitStatus.files.length > 0,
  );
  const composerDiffSummary = summarizeDiff(diff);
  const fallbackTitle = React.useMemo(
    () => getConversationTitle(timelineEvents),
    [timelineEvents],
  );
  const renderedSessionTitle = sessionTitle ?? fallbackTitle;
  const hasActiveSession = Boolean(activeSessionId);
  const isSessionPinned = Boolean(activeSessionPinnedAt);
  const selectedOpenTarget =
    openTargets.find((target) => target.id === defaultOpenTargetId) ??
    FALLBACK_OPEN_TARGETS[0];
  const activePermissionRequest = pendingPermissions[0] ?? null;
  const composerMode = workflowComposerMode(activePermissionRequest);
  const activePlanSummary =
    activePermissionRequest?.toolName === "ExitPlanMode"
      ? extractPlanSummary(activePermissionRequest)
      : "";
  const workflowNodes = React.useMemo(
    () =>
      buildWorkflowNodes({
        activePermissionRequest,
        items: timelineItems,
        sessionStatus,
      }),
    [activePermissionRequest, sessionStatus, timelineItems],
  );
  const composerTransition = useHeightTransition([
    composerMode,
    activePermissionRequest?.requestId ?? "",
    showComposerChangeSummary,
    composer ? "mounted" : "unmounted",
  ]);

  React.useEffect(() => {
    let mounted = true;
    void desktopClient
      .listOpenTargets()
      .then((targets) => {
        if (!mounted) return;
        setOpenTargets(targets.length ? targets : FALLBACK_OPEN_TARGETS);
      })
      .catch(() => {
        if (mounted) {
          setOpenTargets(FALLBACK_OPEN_TARGETS);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  function closeSessionMenu(): void {
    setSessionMenuOpen(false);
  }

  function copyText(text: string): void {
    closeSessionMenu();
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  function copySessionDeepLink(): void {
    if (!activeSessionId) return;
    const url = new URL(window.location.href);
    url.pathname = `/sessions/${encodeURIComponent(activeSessionId)}`;
    url.search = "";
    url.hash = "";
    copyText(url.toString());
  }

  function openBranchFlow(): void {
    closeSessionMenu();
    onCreateBranch();
  }

  function openAutomationView(): void {
    closeSessionMenu();
    onOpenAutomation();
  }

  function toggleSessionPinned(): void {
    closeSessionMenu();
    onToggleSessionPinned();
  }

  function archiveCurrentSession(): void {
    closeSessionMenu();
    onArchiveSession();
  }

  function openWorkspaceWithDefaultTarget(): void {
    if (!workspacePath) return;
    onOpenWorkspacePath();
  }

  function selectOpenTarget(targetId: string): void {
    if (!workspacePath) return;
    setOpenTargetMenuOpen(false);
    setDefaultOpenTargetId(targetId);
    void desktopClient
      .getDesktopSettings()
      .then((settings) =>
        desktopClient.saveDesktopSettings({
          ...settings,
          defaultOpenTargetId: targetId,
        }),
      )
      .catch(() => undefined)
      .then(() => {
        onOpenWorkspacePath();
      });
  }

  function toggleReviewSidebar(): void {
    onOpenRightDock('review');
    onRefreshDiff();
  }

  function openReviewSidebar(): void {
    onRefreshDiff();
    onOpenRightDock('review');
  }

  return (
    <section
      className={
        activePermissionRequest
          ? "conversation-page workflow-page approval-active"
          : "conversation-page workflow-page"
      }
    >
      <header className="chat-session-header">
        <div className="chat-session-title">
          <span>
            {isConversationLoading ? "加载对话中" : renderedSessionTitle}
          </span>
          <PopoverMenu
            align="start"
            className="popover-session-actions"
            open={sessionMenuOpen}
            trigger={
              <button
                aria-label="更多会话操作"
                className="message-action"
                title="更多操作"
                type="button"
              >
                <MoreHorizontal size={APP_ICON_SIZE} />
              </button>
            }
            onOpenChange={setSessionMenuOpen}
          >
            <PopoverItem
              icon={<Pin size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+P"
              disabled={!hasActiveSession}
              onClick={toggleSessionPinned}
            >
              {isSessionPinned ? "取消置顶" : "置顶对话"}
            </PopoverItem>
            <PopoverItem
              disabled
              icon={<Pencil size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+R"
            >
              重命名对话
            </PopoverItem>
            <PopoverItem
              disabled={!hasActiveSession}
              icon={<Archive size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Shift+A"
              onClick={archiveCurrentSession}
            >
              归档对话
            </PopoverItem>
            <div className="popover-divider" />
            <PopoverItem
              disabled
              icon={<MessageSquarePlus size={APP_ICON_SIZE} />}
            >
              打开侧边聊天
            </PopoverItem>
            <SessionSubmenu
              disabled={!hasActiveSession && !workspacePath}
              icon={<Copy size={APP_ICON_SIZE} />}
              label="复制"
            >
              <PopoverItem
                disabled={!workspacePath}
                icon={<Copy size={APP_ICON_SIZE} />}
                shortcut="Ctrl+Shift+C"
                onClick={() => copyText(workspacePath ?? "")}
              >
                复制工作目录
              </PopoverItem>
              <PopoverItem
                disabled={!hasActiveSession}
                icon={<Copy size={APP_ICON_SIZE} />}
                shortcut="Ctrl+Alt+C"
                onClick={() => copyText(activeSessionId ?? "")}
              >
                复制会话 ID
              </PopoverItem>
              <PopoverItem
                disabled={!hasActiveSession}
                icon={<Copy size={APP_ICON_SIZE} />}
                shortcut="Ctrl+Alt+L"
                onClick={copySessionDeepLink}
              >
                复制深度链接
              </PopoverItem>
            </SessionSubmenu>
            <SessionSubmenu
              disabled={!workspacePath}
              icon={<GitBranch size={APP_ICON_SIZE} />}
              label="分支"
            >
              <PopoverItem
                icon={<Laptop size={APP_ICON_SIZE} />}
                onClick={openBranchFlow}
              >
                派生到本地
              </PopoverItem>
              <PopoverItem disabled icon={<GitBranch size={APP_ICON_SIZE} />}>
                派生到新工作树
              </PopoverItem>
            </SessionSubmenu>
            <PopoverItem
              icon={<Workflow size={APP_ICON_SIZE} />}
              onClick={openAutomationView}
            >
              添加自动化...
            </PopoverItem>
            <div className="popover-divider" />
            <PopoverItem
              disabled
              icon={<AppWindow size={APP_ICON_SIZE} />}
            >
              在新窗口中打开
            </PopoverItem>
          </PopoverMenu>
        </div>
        <div className="chat-session-actions">
          <div className="open-target-split-button">
            <Tooltip content={`用 ${selectedOpenTarget.label} 打开`}>
              <button
                aria-label={`用 ${selectedOpenTarget.label} 打开`}
                className="message-action open-target-main"
                disabled={!workspacePath}
                type="button"
                onClick={openWorkspaceWithDefaultTarget}
              >
                {renderOpenTargetIcon(selectedOpenTarget)}
              </button>
            </Tooltip>
            <PopoverMenu
              align="end"
              className="popover-open-targets"
              open={openTargetMenuOpen}
              sideOffset={4}
              trigger={
                <button
                  aria-label="切换默认打开目标"
                  className="message-action open-target-trigger"
                  disabled={!workspacePath}
                  type="button"
                >
                  <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </button>
              }
              onOpenChange={setOpenTargetMenuOpen}
            >
              {openTargets.map((target) => (
                <PopoverItem
                  icon={renderOpenTargetIcon(target)}
                  key={target.id}
                  selected={target.id === defaultOpenTargetId}
                  withCheck
                  onClick={() => selectOpenTarget(target.id)}
                >
                  {target.label}
                </PopoverItem>
              ))}
            </PopoverMenu>
          </div>
          <Tooltip
            content={showPinnedSummary ? "隐藏置顶摘要" : "显示置顶摘要"}
          >
            <button
              aria-label={showPinnedSummary ? "隐藏置顶摘要" : "显示置顶摘要"}
              aria-pressed={showPinnedSummary}
              className="message-action"
              disabled={!workspacePath}
              type="button"
              onClick={() => setShowPinnedSummary((current) => !current)}
            >
              <Columns2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          </Tooltip>
          <Tooltip
            content={
              workflowTimelineVisible
                ? "隐藏 workflow 事件"
                : "显示 workflow 事件"
            }
          >
            <button
              aria-label={
                workflowTimelineVisible
                  ? "隐藏 workflow 事件"
                  : "显示 workflow 事件"
              }
              aria-pressed={workflowTimelineVisible}
              className="message-action"
              disabled={!hasActiveSession}
              type="button"
              onClick={() => setWorkflowTimelineVisible((current) => !current)}
            >
              <Workflow size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          </Tooltip>
          <Tooltip
            content={bottomPanelVisible ? "隐藏底部面板" : "显示底部面板"}
          >
            <button
              aria-label={bottomPanelVisible ? "隐藏底部面板" : "显示底部面板"}
              aria-pressed={bottomPanelVisible}
              className="message-action"
              type="button"
              onClick={() => setBottomPanelVisible((current) => !current)}
            >
              <PanelBottom size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          </Tooltip>
          <Tooltip
            content={
              rightDockOpen && rightDockTool === 'review'
                ? "右侧审查已打开"
                : "显示右侧审查"
            }
          >
            <button
              aria-label="显示右侧审查"
              aria-pressed={rightDockOpen && rightDockTool === 'review'}
              className="message-action"
              type="button"
              onClick={toggleReviewSidebar}
            >
              <PanelRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          </Tooltip>
        </div>
      </header>

      <div className="workflow-page__body">
        <WorkflowNodeSidebar nodes={workflowNodes} />

        <main className="workflow-page__main">
          <div className="workflow-page__scroll">
            <div className="quick-chat-content workflow-page__inner">
              <div className="conversation-stream">
                {isConversationLoading ? (
                  <div className="assistant-thinking">加载对话中</div>
                ) : (
                  <>
                    {workflowTimelineVisible ? (
                      <WorkflowDebugTimeline
                        activeSessionId={activeSessionId}
                        consistencyDiagnostics={workflowConsistencyDiagnostics}
                        diagnostics={workflowDerivedState.diagnostics}
                        events={workflowEvents}
                        workspacePath={workspacePath}
                      />
                    ) : null}
                    {timelineItems.map((item) => (
                      <TimelineItem
                        item={item}
                        key={item.id}
                        showActions={
                          item.type === "message" &&
                          item.role === "assistant" &&
                          assistantActionMessageIds.has(item.id)
                        }
                        onDiscardChanges={(paths) => void handleDiscardChanges(paths)}
                        onReviewCode={handleRunCodeReview}
                        onReviewFiles={openReviewSidebar}
                      />
                    ))}
                  </>
                )}
                {activePermissionRequest?.toolName === "ExitPlanMode" &&
                activePlanSummary ? (
                  <WorkflowPlanCard summary={activePlanSummary} />
                ) : null}
                {!isConversationLoading && showThinking ? <ThinkingPill /> : null}
              </div>
            </div>
          </div>

          {composer ? (
            <footer className="chat-composer workflow-page__composer">
              <div
                ref={composerTransition.ref}
                className={`workflow-page__composer-inner workflow-page__composer-inner--${composerMode}`}
                style={composerTransition.style}
              >
                {showComposerChangeSummary ? (
                  <div className="composer-change-summary">
                    <span>
                      {gitStatus?.files.length ?? 0} 个文件已更改
                      <strong> +{formatPanelNumber(composerDiffSummary.additions)}</strong>
                      <em> -{formatPanelNumber(composerDiffSummary.deletions)}</em>
                    </span>
                    <button type="button" onClick={handleRunCodeReview}>审查</button>
                  </div>
                ) : null}
                {activePermissionRequest ? (
                  <InlineApprovalCard
                    request={activePermissionRequest}
                    currentPermissionMode={permissionMode}
                    onDecide={onDecidePermission}
                    onAcceptExitPlanMode={onAcceptExitPlanMode}
                  />
                ) : (
                  composer
                )}
              </div>
            </footer>
          ) : null}
        </main>
      </div>
    </section>
  );
}

function WorkflowDebugTimeline({
  activeSessionId,
  consistencyDiagnostics,
  diagnostics,
  events,
  workspacePath,
}: {
  activeSessionId: string | null;
  consistencyDiagnostics: WorkflowConsistencyDiagnostics;
  diagnostics: ReturnType<typeof deriveWorkflowSessionState>["diagnostics"];
  events: DesktopWorkflowEvent[];
  workspacePath: string | null;
}): React.ReactNode {
  const visibleEvents = events.slice(-60).reverse();
  const [logDiagnostics, setLogDiagnostics] =
    React.useState<WorkflowMarkdownLogDiagnostics | null>(null);

  function inspectWorkflowLog(): void {
    void desktopClient
      .readWorkflowEventLog()
      .then((logEvents) => {
        const filteredEvents = activeSessionId
          ? logEvents.filter((event) => event.threadId === activeSessionId)
          : logEvents;
        setLogDiagnostics({
          count: filteredEvents.length,
          diagnostics: deriveWorkflowSessionState(
            filteredEvents,
            activeSessionId,
          ).diagnostics,
          note:
            filteredEvents.length === 0
              ? "事件日志未启用或无日志事件"
              : undefined,
        });
      })
      .catch(() => {
        setLogDiagnostics({
          count: 0,
          diagnostics: {
            duplicateEventIds: [],
            missingToolResults: [],
            outOfOrderSequences: [],
          },
          note: "事件日志未启用或无日志事件",
        });
      });
  }

  function copyWorkflowMarkdown(): void {
    void copyWorkflowMarkdownAsync();
  }

  async function copyWorkflowMarkdownAsync(): Promise<void> {
    const codexContextDiagnostics = workspacePath
      ? await buildWorkspaceCodexContextDiagnostics({
          workspacePath,
          readWorkspaceFile: desktopClient.readWorkspaceFile,
          readOptionalWorkspaceFile: desktopClient.readOptionalWorkspaceFile,
        })
      : null;
    const markdown = buildWorkflowMarkdownReport({
      activeSessionId,
      codexContextDiagnostics,
      consistencyDiagnostics,
      diagnostics,
      events,
      logDiagnostics,
    });
    await navigator.clipboard?.writeText(markdown).catch(() => undefined);
  }

  return (
    <section className="workflow-debug-timeline">
      <div className="workflow-debug-timeline-header">
        <span>Workflow 事件</span>
        <div className="workflow-debug-timeline-actions">
          <small>{events.length} 条</small>
          <button type="button" onClick={copyWorkflowMarkdown}>
            复制 MD
          </button>
          <button type="button" onClick={inspectWorkflowLog}>
            检查日志
          </button>
        </div>
      </div>
      <WorkflowDiagnosticsSummary
        diagnostics={diagnostics}
        label="当前"
        total={events.length}
      />
      <WorkflowConsistencySummary diagnostics={consistencyDiagnostics} />
      {logDiagnostics ? (
        <>
          <WorkflowDiagnosticsSummary
            diagnostics={logDiagnostics.diagnostics}
            label="日志"
            total={logDiagnostics.count}
          />
          {logDiagnostics.note ? (
            <div className="workflow-debug-empty">{logDiagnostics.note}</div>
          ) : null}
        </>
      ) : null}
      {visibleEvents.length === 0 ? (
        <div className="workflow-debug-empty">暂无 workflow 事件</div>
      ) : (
        <div className="workflow-debug-list">
          {visibleEvents.map((event, index) => (
            <article
              className={`workflow-debug-event ${workflowEventTone(event)}`}
              key={`${event.type}-${event.threadId}-${event.createdAt}-${index}`}
            >
              <div className="workflow-debug-event-header">
                <strong>{event.type}</strong>
                <time>{formatWorkflowTime(event.createdAt)}</time>
              </div>
              <div className="workflow-debug-event-grid">
                <span>thread</span>
                <code>{event.threadId}</code>
                {"turnId" in event ? (
                  <>
                    <span>turn</span>
                    <code>{event.turnId}</code>
                  </>
                ) : null}
                {"item" in event ? (
                  <>
                    <span>item</span>
                    <code>
                      {event.item.type} / {event.item.status}
                    </code>
                  </>
                ) : null}
                {workflowEventDetail(event).map((detail) => (
                  <React.Fragment key={detail.label}>
                    <span>{detail.label}</span>
                    <code>{detail.value}</code>
                  </React.Fragment>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkflowConsistencySummary({
  diagnostics,
}: {
  diagnostics: WorkflowConsistencyDiagnostics;
}): React.ReactNode {
  const total = workflowConsistencyIssueCount(diagnostics);
  return (
    <div className="workflow-debug-diagnostics">
      一致性：{total} 个
      <span>缺 turn 终止事件 {diagnostics.missingTurnCompletions.length}</span>
      <span>未配对 call {diagnostics.unpairedToolCalls.length}</span>
      <span>孤立 result {diagnostics.unpairedToolResults.length}</span>
      <span>未决权限 {diagnostics.pendingPermissionRequests.length}</span>
      <span>回复不一致 {diagnostics.finalResponseMismatches.length}</span>
      <span>混入 thread {diagnostics.mixedThreadIds.length}</span>
    </div>
  );
}

function WorkflowDiagnosticsSummary({
  diagnostics,
  label,
  total,
}: {
  diagnostics: ReturnType<typeof deriveWorkflowSessionState>["diagnostics"];
  label: string;
  total: number;
}): React.ReactNode {
  const issues =
    diagnostics.duplicateEventIds.length +
    diagnostics.missingToolResults.length +
    diagnostics.outOfOrderSequences.length;
  return (
    <div className="workflow-debug-empty">
      <div>
        {label}: {total} 条，{issues} 个诊断
        {issues > 0
          ? `（重复 ${diagnostics.duplicateEventIds.length}，未完成工具 ${diagnostics.missingToolResults.length}，乱序 ${diagnostics.outOfOrderSequences.length}）`
          : ""}
      </div>
      {issues > 0 ? (
        <div className="workflow-debug-diagnostic-list">
          {diagnostics.duplicateEventIds.length > 0 ? (
            <span>
              重复: {diagnostics.duplicateEventIds.slice(0, 3).join(", ")}
            </span>
          ) : null}
          {diagnostics.missingToolResults.length > 0 ? (
            <span>
              未完成工具: {diagnostics.missingToolResults.slice(0, 3).join(", ")}
            </span>
          ) : null}
          {diagnostics.outOfOrderSequences.length > 0 ? (
            <span>
              乱序:{" "}
              {diagnostics.outOfOrderSequences
                .slice(0, 3)
                .map(({ previous, current }) => `${previous}->${current}`)
                .join(", ")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function workflowEventDetail(
  event: DesktopWorkflowEvent,
): Array<{ label: string; value: string }> {
  if ("item" in event) {
    const item = event.item;
    if (item.type === "tool_call" || item.type === "tool_result") {
      return [
        {
          label: "tool",
          value: "toolName" in item ? item.toolName : "tool",
        },
      ];
    }
    if (item.type === "permission_request") {
      return [
        {
          label: "request",
          value:
            "request" in item && item.request
              ? item.request.requestId
              : "permission",
        },
      ];
    }
    if (item.type === "error") {
      return [
        {
          label: "error",
          value: "message" in item ? item.message : "error",
        },
      ];
    }
    if (item.type === "file_change") {
      return [
        {
          label: "file",
          value: "filePath" in item ? item.filePath : "file",
        },
      ];
    }
  }

  if (event.type === "turn.completed") {
    return [
      {
        label: "stop",
        value: event.stopReason ?? "completed",
      },
    ];
  }
  if (event.type === "turn.failed") {
    return [{ label: "error", value: event.error.message }];
  }
  if (event.type === "turn.interrupted") {
    return [{ label: "reason", value: event.reason ?? "interrupted" }];
  }
  return [];
}

function workflowEventTone(event: DesktopWorkflowEvent): string {
  if (event.type === "turn.failed") return "error";
  if ("item" in event && event.item.status === "failed") return "error";
  if (event.type === "turn.completed") return "success";
  if (event.type === "turn.interrupted") return "warning";
  return "neutral";
}

function formatWorkflowTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function SessionSubmenu({
  children,
  disabled,
  icon,
  label,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}): React.ReactNode {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className="popover-item popover-sub-trigger"
        disabled={disabled}
        tabIndex={-1}
      >
        <span className="popover-item-icon">{icon}</span>
        <span className="popover-item-label">{label}</span>
        <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZE} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          alignOffset={-6}
          className="popover popover-sub-content popover-auto-width"
          sideOffset={8}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function renderOpenTargetIcon(target: DesktopOpenTarget): React.ReactNode {
  if (target.iconDataUrl) {
    return (
      <img
        alt=""
        className="chat-open-target-icon"
        src={target.iconDataUrl}
      />
    );
  }
  if (target.kind === "file-explorer") {
    return <FolderOpen size={APP_ICON_SIZE} />;
  }
  if (target.kind === "terminal") {
    return <SquareTerminal size={APP_ICON_SIZE} />;
  }
  if (target.kind === "editor") {
    return <Code2 size={APP_ICON_SIZE} />;
  }
  return <File size={APP_ICON_SIZE} />;
}

type WorkflowComposerMode = "chat" | "brainstorm" | "plan" | "permission";

type WorkflowNodeKind =
  | "assistant"
  | "file"
  | "permission"
  | "plan"
  | "question"
  | "status"
  | "tool";

type WorkflowNodeState = "pending" | "active" | "done" | "failed";

type WorkflowNodeViewModel = {
  id: string;
  index: number;
  kind: WorkflowNodeKind;
  state: WorkflowNodeState;
  title: string;
  detail?: string;
};

function deriveWorkflowThinkingVisible({
  pendingPermissions,
  sessionStatus,
  timelineEvents,
}: {
  pendingPermissions: DesktopPermissionRequest[];
  sessionStatus: DesktopSessionStatus;
  timelineEvents: DesktopSessionEvent[];
}): boolean {
  if (sessionStatus !== "running" && sessionStatus !== "waiting") return false;
  if (pendingPermissions.length > 0) return false;

  const lastUserMessageIndex = findLastIndex(
    timelineEvents,
    (event) =>
      event.type === "message" &&
      event.role === "user" &&
      Boolean(event.content?.trim()),
  );
  if (lastUserMessageIndex === -1) return false;

  const currentTurnEvents = timelineEvents.slice(lastUserMessageIndex + 1);
  for (const event of currentTurnEvents) {
    const type = event.type as string;
    if (type === "checkpoint" || type === "error" || type === "turn.interrupted") {
      return false;
    }
    if (
      (event.type === "message" || event.type === "assistant_delta") &&
      event.role === "assistant" &&
      Boolean(event.content?.trim())
    ) {
      return false;
    }
  }

  return true;
}

export function deriveAssistantActionMessageIds({
  sessionStatus,
  timelineEvents,
}: {
  sessionStatus: DesktopSessionStatus;
  timelineEvents: DesktopSessionEvent[];
}): Set<string> {
  const visibleIds = new Set<string>();
  let turnOpen = false;
  let lastAssistantMessageId: string | null = null;

  function closeTurn(): void {
    if (lastAssistantMessageId) {
      visibleIds.add(lastAssistantMessageId);
    }
    turnOpen = false;
    lastAssistantMessageId = null;
  }

  for (const event of timelineEvents) {
    if (
      event.type === "message" &&
      event.role === "user" &&
      Boolean(event.content?.trim())
    ) {
      if (!turnOpen) {
        turnOpen = true;
        lastAssistantMessageId = null;
      }
      continue;
    }

    if (!turnOpen) continue;

    if (
      event.type === "message" &&
      event.role === "assistant" &&
      Boolean(event.content?.trim())
    ) {
      lastAssistantMessageId = event.id;
      continue;
    }

    if (event.type === "checkpoint" || event.type === "error") {
      closeTurn();
    }
  }

  if (turnOpen && lastAssistantMessageId && !isActiveSessionStatus(sessionStatus)) {
    visibleIds.add(lastAssistantMessageId);
  }

  return visibleIds;
}

function isActiveSessionStatus(sessionStatus: DesktopSessionStatus): boolean {
  return sessionStatus === "running" || sessionStatus === "waiting";
}

function findLastIndex<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) return index;
  }
  return -1;
}

function WorkflowNodeSidebar({
  nodes,
}: {
  nodes: WorkflowNodeViewModel[];
}): React.ReactNode {
  return (
    <aside className="workflow-page__sidebar" aria-label="工作流时间节点">
      <header className="workflow-page__sidebar-title">
        <span>工作流时间节点</span>
        <span className="workflow-page__sidebar-count">{nodes.length}</span>
      </header>
      <ol className="workflow-page__timeline">
        {nodes.length > 0 ? (
          nodes.map((node) => (
            <li
              className={`workflow-node workflow-node--${node.state} workflow-node--${node.kind}`}
              key={node.id}
            >
              <span className="workflow-node__dot" aria-hidden="true">
                {node.state === "done" ? (
                  <Check size={10} />
                ) : node.state === "failed" ? (
                  <X size={10} />
                ) : null}
              </span>
              <span className="workflow-node__index">{node.index}</span>
              <span className="workflow-node__copy">
                <span className="workflow-node__title" title={node.title}>
                  {node.title}
                </span>
                {node.detail ? (
                  <span className="workflow-node__detail" title={node.detail}>
                    {node.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))
        ) : (
          <li className="workflow-node workflow-node--pending workflow-node--status">
            <span className="workflow-node__dot" aria-hidden="true">
              <Circle size={10} />
            </span>
            <span className="workflow-node__index">1</span>
            <span className="workflow-node__copy">
              <span className="workflow-node__title">等待开始</span>
            </span>
          </li>
        )}
      </ol>
    </aside>
  );
}

function WorkflowPlanCard({
  summary,
}: {
  summary: string;
}): React.ReactNode {
  const [expanded, setExpanded] = React.useState(false);
  const title = planTitleFromSummary(summary);

  return (
    <article
      className={
        expanded
          ? "workflow-plan-card workflow-plan-card--expanded"
          : "workflow-plan-card"
      }
    >
      <header className="workflow-plan-card__header">
        <span className="workflow-plan-card__label">编写计划</span>
        <button
          aria-label={expanded ? "折叠计划" : "展开计划"}
          className="workflow-plan-card__fold"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </button>
      </header>

      <h2 className="workflow-plan-card__title">{title}</h2>

      <div className="workflow-plan-card__body">
        <MarkdownMessage text={summary} />
        {!expanded ? <div className="workflow-plan-card__mask" aria-hidden="true" /> : null}
      </div>

      {!expanded ? (
        <footer className="workflow-plan-card__footer">
          <button
            className="workflow-plan-card__expand"
            type="button"
            onClick={() => setExpanded(true)}
          >
            展开计划
          </button>
        </footer>
      ) : null}
    </article>
  );
}

function planTitleFromSummary(summary: string): string {
  const heading = summary.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const proposedTitle = summary.match(/^\s*title:\s*(.+)$/im)?.[1]?.trim();
  return proposedTitle || "计划书";
}

type TimelineToolRun = {
  id: string;
  toolUseId?: string;
  toolName: string;
  callContent: string;
  resultContent: string;
  isError: boolean;
  isRunning: boolean;
  isWaitingForPermission: boolean;
  startedAtMs?: number;
};

type TimelineToolGroup = {
  id: string;
  type: "tool_group";
  runs: TimelineToolRun[];
};

type TimelineItem = DesktopSessionEvent | TimelineToolGroup;

function workflowComposerMode(
  request: DesktopPermissionRequest | null,
): WorkflowComposerMode {
  if (!request) return "chat";
  if (request.toolName === "AskUserQuestion") return "brainstorm";
  if (request.toolName === "ExitPlanMode") return "plan";
  return "permission";
}

function buildWorkflowNodes({
  activePermissionRequest,
  items,
  sessionStatus,
}: {
  activePermissionRequest: DesktopPermissionRequest | null;
  items: TimelineItem[];
  sessionStatus: DesktopSessionStatus;
}): WorkflowNodeViewModel[] {
  const nodes: Array<Omit<WorkflowNodeViewModel, "index">> = [];

  for (const item of items) {
    const node = workflowNodeFromTimelineItem(item);
    if (node) nodes.push(node);
  }

  if (activePermissionRequest) {
    nodes.push({
      id: `permission-node-${activePermissionRequest.requestId}`,
      kind: workflowNodeKindForPermission(activePermissionRequest),
      state: "active",
      title: workflowTitleForPermission(activePermissionRequest),
      detail: activePermissionRequest.description,
    });
  } else if (sessionStatus === "running" || sessionStatus === "waiting") {
    if (nodes.length === 0) {
      nodes.push({
        id: "workflow-node-thinking",
        kind: "status",
        state: "active",
        title: "正在思考",
      });
    } else {
      const last = nodes[nodes.length - 1];
      if (last && last.state === "done") {
        nodes[nodes.length - 1] = { ...last, state: "active" };
      }
    }
  }

  return nodes.map((node, index) => ({
    ...node,
    index: index + 1,
  }));
}

function workflowNodeFromTimelineItem(
  item: TimelineItem,
): Omit<WorkflowNodeViewModel, "index"> | null {
  if (item.type === "tool_group") {
    const failed = item.runs.some((run) => run.isError);
    const running = item.runs.some((run) => run.isRunning);
    const firstToolName = item.runs[0]?.toolName ?? "命令";
    return {
      id: `node-${item.id}`,
      kind: "tool",
      state: failed ? "failed" : running ? "active" : "done",
      title:
        item.runs.length === 1
          ? displayToolName(firstToolName)
          : `已运行 ${item.runs.length} 条命令`,
      detail: item.runs.map((run) => displayToolName(run.toolName)).join("、"),
    };
  }

  if (item.type === "message" || item.type === "assistant_delta") {
    if (item.role === "user") return null;
    const content = item.content?.trim() ?? "";
    if (!content) return null;
    return {
      id: `node-${item.id}`,
      kind: "assistant",
      state: item.type === "assistant_delta" ? "active" : "done",
      title: trimNodeTitle(content),
    };
  }

  if (item.type === "proposed_plan") {
    const content = item.content?.trim() ?? "";
    if (!content) return null;
    return {
      id: `node-${item.id}`,
      kind: "plan",
      state: item.metadata?.streaming === true ? "active" : "done",
      title: planTitleFromSummary(content),
    };
  }

  if (item.type === "file_patch") {
    return {
      id: `node-${item.id}`,
      kind: "file",
      state: "done",
      title: "编辑文件",
      detail: filePatchNodeDetail(item),
    };
  }

  if (item.type === "permission_request") {
    return {
      id: `node-${item.id}`,
      kind: "permission",
      state: "done",
      title: item.content?.trim() || "权限确认",
    };
  }

  if (item.type === "error") {
    return {
      id: `node-${item.id}`,
      kind: "status",
      state: "failed",
      title: trimNodeTitle(item.content ?? "发生错误"),
    };
  }

  return null;
}

function workflowNodeKindForPermission(
  request: DesktopPermissionRequest,
): WorkflowNodeKind {
  if (request.toolName === "AskUserQuestion") return "question";
  if (request.toolName === "ExitPlanMode") return "plan";
  return "permission";
}

function workflowTitleForPermission(request: DesktopPermissionRequest): string {
  if (request.toolName === "AskUserQuestion") return "等待用户回答问题";
  if (request.toolName === "ExitPlanMode") return "确认计划";
  return "等待权限确认";
}

function filePatchNodeDetail(event: DesktopSessionEvent): string | undefined {
  const files = Array.isArray(event.metadata?.files)
    ? (event.metadata.files as Array<Record<string, unknown>>)
    : [];
  if (files.length > 0) {
    return `${files.length} 个文件`;
  }
  const filePath =
    typeof event.metadata?.filePath === "string"
      ? event.metadata.filePath
      : undefined;
  return filePath;
}

function trimNodeTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 30) return normalized;
  return `${normalized.slice(0, 30)}...`;
}

function TimelineItem({
  item,
  showActions,
  onReviewFiles,
  onReviewCode,
  onDiscardChanges,
}: {
  item: TimelineItem;
  showActions: boolean;
  onReviewFiles: () => void;
  onReviewCode: () => void;
  onDiscardChanges: (paths: string[]) => void;
}): React.ReactNode {
  if (item.type === "tool_group") {
    return <TimelineToolGroupView group={item} />;
  }

  const event = item;
  if (event.type === "message" || event.type === "assistant_delta") {
    return (
      <ChatMessage
        message={{
          id: event.id,
          role: event.role ?? "system",
          text: event.content ?? "",
          createdAt: event.createdAt,
          streaming: event.type === "assistant_delta",
        }}
        showActions={showActions}
      />
    );
  }

  if (event.type === "proposed_plan") {
    const summary = event.content?.trim() ?? "";
    return summary ? <WorkflowPlanCard summary={summary} /> : null;
  }

  if (event.type === "tool_call" || event.type === "tool_result") {
    return null;
  }

  if (event.type === "file_patch") {
    const files = Array.isArray(event.metadata?.files)
      ? (event.metadata.files as Array<Record<string, unknown>>)
      : [];
    const additions = numberMetadata(event, "additions");
    const deletions = numberMetadata(event, "deletions");
    const fileCount = files.length;
    const title = `已编辑 ${fileCount || 1} 个文件`;
    const totalAdditions =
      additions ?? files.reduce((total, file) => total + Number(file.additions ?? 0), 0);
    const totalDeletions =
      deletions ?? files.reduce((total, file) => total + Number(file.deletions ?? 0), 0);
    const filePaths = files
      .map(file => (typeof file.path === "string" ? file.path : null))
      .filter((p): p is string => Boolean(p));
    const filePathFromMetadata =
      typeof event.metadata?.filePath === "string"
        ? (event.metadata.filePath as string)
        : null;
    const discardPaths =
      filePaths.length > 0
        ? filePaths
        : filePathFromMetadata
          ? [filePathFromMetadata]
          : [];
    return (
      <article className="timeline-file-event">
        <div className="timeline-file-event-header">
          <div className="timeline-file-event-summary">
            <span className="timeline-file-event-icon">
              <FileDiff size={APP_ICON_SIZE} />
            </span>
            <span className="timeline-file-event-copy">
              <strong>{title}</strong>
              <small>
                <span className="diff-added">+{formatPanelNumber(totalAdditions)}</span>
                <span className="diff-removed">-{formatPanelNumber(totalDeletions)}</span>
              </small>
            </span>
          </div>
          <div className="timeline-file-event-actions">
            <button
              className="timeline-file-event-ghost-button"
              disabled={discardPaths.length === 0}
              type="button"
              onClick={() => {
                if (discardPaths.length === 0) return;
                if (window.confirm(`确认放弃 ${discardPaths.length} 个文件的编辑？`)) {
                  onDiscardChanges(discardPaths);
                }
              }}
            >
              撤销
              <RotateCcw size={APP_ICON_SIZE} />
            </button>
            <button
              className="timeline-file-event-review-button"
              type="button"
              onClick={onReviewCode}
            >
              审核
            </button>
          </div>
        </div>
        {files.length > 0 ? (
          <ul className="timeline-file-event-list">
            {files.map((file, index) => (
              <li key={`${String(file.path ?? "file")}-${index}`}>
                <span>{String(file.path ?? "file")}</span>
                <small>
                  <span className="diff-added">
                    +{formatPanelNumber(Number(file.additions ?? 0))}
                  </span>
                  <span className="diff-removed">
                    -{formatPanelNumber(Number(file.deletions ?? 0))}
                  </span>
                </small>
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    );
  }

  if (event.type === "permission_request" || event.type === "error") {
    return (
      <article className={`timeline-system-event ${event.type}`}>
        {event.content}
      </article>
    );
  }

  if (event.type === "status" || event.type === "checkpoint") {
    return null;
  }

  return null;
}

function TimelineToolGroupView({
  group,
}: {
  group: TimelineToolGroup;
}): React.ReactNode {
  const [expanded, setExpanded] = React.useState(false);
  const [openRunIds, setOpenRunIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const commandCount = group.runs.length;

  const firstRunningRun = group.runs.find((r) => r.isRunning);
  const groupElapsed = useElapsedSeconds(
    firstRunningRun?.startedAtMs,
    Boolean(firstRunningRun),
  );
  const groupSummaryLabel = firstRunningRun
    ? `正在运行命令，已持续 ${groupElapsed} s`
    : commandCount === 1
      ? "已运行命令"
      : `已运行 ${commandCount} 条命令`;

  return (
    <article
      className={
        expanded
          ? "timeline-command-group timeline-command-group--expanded"
          : "timeline-command-group"
      }
    >
      <button
        aria-expanded={expanded}
        className="timeline-command-group-summary"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        <Code2 size={APP_ICON_SIZE} />
        <span>
          {groupSummaryLabel}
        </span>
        <ChevronDown
          className="timeline-command-group-chevron"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </button>
      <div
        aria-hidden={!expanded}
        className="timeline-command-details"
      >
        <div className="timeline-command-details-inner">
          <ul className="timeline-command-list">
            {group.runs.map((run) => {
              return (
                <TimelineCommandRunItem
                  key={run.id}
                  run={run}
                  isOpen={openRunIds.has(run.id)}
                  onToggle={() =>
                    setOpenRunIds((value) =>
                      toggleOpenCommandRunIds(value, run.id),
                    )
                  }
                />
              );
            })}
          </ul>
        </div>
      </div>
    </article>
  );
}

export function toggleOpenCommandRunIds(
  openRunIds: ReadonlySet<string>,
  runId: string,
): Set<string> {
  const nextOpenRunIds = new Set(openRunIds);
  if (nextOpenRunIds.has(runId)) {
    nextOpenRunIds.delete(runId);
  } else {
    nextOpenRunIds.add(runId);
  }
  return nextOpenRunIds;
}

type CommandRunStatusKind = "success" | "error" | "running";

type CommandRunView = {
  commandLabel: string;
  displayCommand: string;
  displayOutput: string;
  shellTitle: string;
  statusKind: CommandRunStatusKind;
  statusLabel: string;
  startedAtMs?: number;
};

export function commandRunView(run: TimelineToolRun): CommandRunView {
  const toolLabel = displayToolName(run.toolName);
  const displayCommand = run.callContent || run.resultContent || toolLabel;
  const statusKind: CommandRunStatusKind = run.isWaitingForPermission || run.isRunning
    ? "running"
    : run.isError
      ? "error"
      : "success";
  const statusLabel = run.isWaitingForPermission
    ? "等待权限"
    : statusKind === "running"
      ? "运行中"
      : statusKind === "error"
        ? "失败"
        : "成功";
  return {
    commandLabel: displayCommand,
    displayCommand,
    displayOutput: run.resultContent,
    shellTitle: toolLabel,
    statusKind,
    statusLabel,
    startedAtMs: run.startedAtMs,
  };
}

function TimelineCommandRunItem({
  run,
  isOpen,
  onToggle,
}: {
  run: TimelineToolRun;
  isOpen: boolean;
  onToggle: () => void;
}): React.ReactNode {
  const view = commandRunView(run);
  const runElapsed = useElapsedSeconds(run.startedAtMs, run.isRunning);
  const rowLabel = run.isRunning
    ? `正在运行命令，已持续 ${runElapsed} s`
    : isOpen
      ? "已运行命令"
      : `已运行 ${view.commandLabel}`;

  return (
    <li
      className={
        isOpen
          ? "timeline-command-item timeline-command-item--open"
          : "timeline-command-item"
      }
    >
      <button
        aria-expanded={isOpen}
        className="timeline-command-row"
        type="button"
        onClick={onToggle}
      >
        <span
          className={
            isOpen
              ? "timeline-command-row-label"
              : "timeline-command-row-command"
          }
          title={view.displayCommand}
        >
          {rowLabel}
        </span>
        <ChevronRight
          className="timeline-command-row-chevron"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </button>

      <div
        aria-hidden={!isOpen}
        className="timeline-command-shell-wrap"
      >
        <article
          className={`timeline-command-shell timeline-command-shell--${view.statusKind}`}
        >
          <div className="timeline-command-shell-header">
            {view.shellTitle}
          </div>
          <pre className="timeline-command-shell-body"><span className="timeline-command-shell-prompt">$</span> {view.displayCommand}{view.displayOutput ? `\n${view.displayOutput}` : ""}</pre>
          <footer className="timeline-command-shell-footer">
            <span className="timeline-command-shell-status">
              {view.statusKind === "success" ? (
                <Check
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : view.statusKind === "error" ? (
                <X
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : (
                <Circle
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              )}
              {view.statusLabel}
            </span>
          </footer>
        </article>
      </div>
    </li>
  );
}

function ChatMessage({
  message,
  showActions,
}: {
  message: Message;
  showActions: boolean;
}): React.ReactNode {
  const shouldTypewrite =
    message.role === "assistant" &&
    !message.streaming &&
    isRecentMessage(message.createdAt);
  const renderedText = useTypewriterText({
    enabled: shouldTypewrite,
    text: message.text,
  });

  if (message.role === "user") {
    return (
      <article className="chat-message-row user">
        <div className="user-message-bubble">{message.text}</div>
        <MessageActionButton label="复制" tip="复制" text={message.text}>
          <Copy size={APP_ICON_SIZE} />
        </MessageActionButton>
      </article>
    );
  }

  return (
    <article className={`chat-message-row ${message.role}`}>
      <div className="assistant-message-body">
        <MarkdownMessage
          text={renderedText}
          streaming={Boolean(message.streaming)}
        />
      </div>
      {showActions && message.role === "assistant" && message.text.trim() ? (
        <div className="assistant-message-actions">
          <MessageActionButton label="复制" tip="复制" text={message.text}>
            <Copy size={APP_ICON_SIZE} />
          </MessageActionButton>
          <Tooltip content="赞">
            <button aria-label="赞" className="message-action" type="button">
              <ThumbsUp size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="踩">
            <button aria-label="踩" className="message-action" type="button">
              <ThumbsDown size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="重新生成">
            <button
              aria-label="重新生成"
              className="message-action"
              type="button"
            >
              <RotateCcw size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </article>
  );
}

function isRecentMessage(createdAt: string | number | undefined): boolean {
  if (createdAt === undefined) return false;
  const timestamp =
    typeof createdAt === "number" ? createdAt : Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < 6000;
}

function MessageActionButton({
  children,
  label,
  tip,
  text,
}: {
  children: React.ReactNode;
  label: string;
  tip: string;
  text: string;
}): React.ReactNode {
  return (
    <Tooltip content={tip}>
      <button
        aria-label={label}
        className="message-action"
        onClick={() => {
          void navigator.clipboard?.writeText(text).catch(() => undefined);
        }}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function getConversationTitle(
  events: Array<{ role?: string; content?: string }>,
): string {
  const firstUserMessage = events.find((event) => event.role === "user");
  const title = firstUserMessage?.content?.trim().split(/\r?\n/)[0] ?? "新对话";
  return title.length > 28 ? `${title.slice(0, 28)}...` : title;
}

type ReviewDiffLine = {
  id: string;
  type: "added" | "removed" | "context" | "hunk" | "meta";
  oldLine: number | null;
  newLine: number | null;
  content: string;
  unmodifiedBefore?: number;
};

type ReviewFile = {
  path: string;
  originalPath?: string;
  status: string;
  additions: number;
  deletions: number;
  isUntracked: boolean;
  lines: ReviewDiffLine[];
};

type ReviewSplitRow = {
  id: string;
  unmodifiedBefore?: number;
  hunk?: { content: string };
  meta?: { content: string };
  left: { number: number | null; content: string; tone: "removed" | "context" | "empty" };
  right: { number: number | null; content: string; tone: "added" | "context" | "empty" };
  paired: boolean;
};

type ReviewFilter = "all" | "added" | "modified" | "removed";

function filterStatusForFile(file: { status: string; isUntracked: boolean }): ReviewFilter {
  if (file.isUntracked) return "added";
  const trimmed = file.status.trim();
  if (trimmed.startsWith("A") || trimmed.startsWith("??")) return "added";
  if (trimmed.startsWith("D")) return "removed";
  return "modified";
}

function ReviewSidebar({
  diff,
  gitStatus,
  events,
  messages,
  sessionStatus,
  isRefreshing,
  reviewView,
  workspacePath,
  onClose,
  onRefreshDiff,
  onOpenWorkspacePath,
  onRunCodeReview,
}: {
  diff: string;
  gitStatus: DesktopGitStatus | null;
  events: DesktopSessionEvent[];
  messages: Array<{ role: string; text: string; createdAt?: string }>;
  sessionStatus: DesktopSessionStatus;
  isRefreshing: boolean;
  reviewView: DesktopReviewView;
  workspacePath: string | null;
  onClose: () => void;
  onRefreshDiff: () => void;
  onOpenWorkspacePath: () => void;
  onRunCodeReview: () => void;
}): React.ReactNode {
  const turnGroup = React.useMemo(
    () => deriveReviewTurns(events),
    [events],
  );
  const turns = turnGroup.turns;
  const [selectedTurnId, setSelectedTurnId] = React.useState<string | null>(null);
  const [turnMenuOpen, setTurnMenuOpen] = React.useState(false);
  const selectedTurn = React.useMemo(
    () => turns.find((turn) => turn.id === selectedTurnId) ?? null,
    [turns, selectedTurnId],
  );
  const effectiveDiff = selectedTurn ? selectedTurn.patch || diff : diff;
  const effectiveGitStatus = React.useMemo<DesktopGitStatus | null>(() => {
    if (!gitStatus) return null;
    if (!selectedTurn) return gitStatus;
    if (selectedTurn.files.length === 0) return gitStatus;
    const allowed = new Set(selectedTurn.files.map((f) => f.path));
    const filteredFiles = gitStatus.files.filter((f) => allowed.has(f.path));
    return {
      ...gitStatus,
      files: filteredFiles,
      clean: filteredFiles.length === 0,
    };
  }, [gitStatus, selectedTurn]);

  const files = React.useMemo(
    () => buildReviewFiles(effectiveDiff, effectiveGitStatus),
    [effectiveDiff, effectiveGitStatus],
  );
  const totals = React.useMemo(
    () =>
      files.reduce(
        (summary, file) => ({
          additions: summary.additions + file.additions,
          deletions: summary.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (
      selectedTurnId &&
      !turns.some((turn) => turn.id === selectedTurnId)
    ) {
      setSelectedTurnId(null);
    }
  }, [turns, selectedTurnId]);

  React.useEffect(() => {
    if (files.length === 0) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath((current) =>
      current && files.some((file) => file.path === current)
        ? current
        : files[0]?.path ?? null,
    );
  }, [files]);

  const visibleFiles = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.filter((file) => {
      if (query && !file.path.toLowerCase().includes(query)) return false;
      if (filter === "all") return true;
      return filterStatusForFile(file) === filter;
    });
  }, [files, search, filter]);

  React.useEffect(() => {
    if (visibleFiles.length === 0) {
      if (files.length > 0 && selectedPath && !visibleFiles.some((f) => f.path === selectedPath)) {
        setSelectedPath(visibleFiles[0]?.path ?? null);
      }
      return;
    }
    if (!selectedPath || !visibleFiles.some((file) => file.path === selectedPath)) {
      setSelectedPath(visibleFiles[0]?.path ?? null);
    }
  }, [visibleFiles, files, selectedPath]);

  const selectedFile =
    visibleFiles.find((file) => file.path === selectedPath) ??
    visibleFiles[0] ??
    null;

  const lastUserMessage = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === "user" && m.text.trim()) return m;
    }
    return null;
  }, [messages]);

  const totalChangedFiles = React.useMemo(() => {
    if (!gitStatus) return 0;
    return gitStatus.files.length;
  }, [gitStatus]);

  const turnMenuLabel = selectedTurn
    ? `第 ${turns.findIndex((t) => t.id === selectedTurn.id) + 1} 轮`
    : `全部轮次`;

  const sessionBusy =
    sessionStatus === "running" || sessionStatus === "waiting";

  return (
    <aside className="review-sidebar" aria-label="代码审查">
      <div className="review-sidebar-toolbar">
        <div className="review-sidebar-title">
          <PopoverMenu
            align="start"
            className="popover-review-turns"
            open={turnMenuOpen}
            sideOffset={4}
            trigger={
              <button
                className="review-sidebar-title-button"
                type="button"
                title="切换审查的对话轮次"
              >
                {turnMenuLabel}
                <ChevronDown
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </button>
            }
            onOpenChange={setTurnMenuOpen}
          >
            <PopoverItem
              selected={selectedTurnId === null}
              withCheck
              onClick={() => {
                setSelectedTurnId(null);
                setTurnMenuOpen(false);
              }}
            >
              全部轮次
            </PopoverItem>
            {turns.length === 0 ? (
              <PopoverItem disabled>暂无 file_patch 事件</PopoverItem>
            ) : (
              turns
                .slice()
                .reverse()
                .map((turn) => (
                  <PopoverItem
                    key={turn.id}
                    selected={turn.id === selectedTurnId}
                    withCheck
                    onClick={() => {
                      setSelectedTurnId(turn.id);
                      setTurnMenuOpen(false);
                    }}
                  >
                    <span className="popover-turn-label">
                      <strong>第 {turn.index} 轮</strong>
                      <small>
                        {truncateToWidth(turn.userMessageText, 60)}
                      </small>
                      <small className="popover-turn-stats">
                        {turn.files.length} 个文件
                        <span className="diff-added">
                          +{formatPanelNumber(turn.additions)}
                        </span>
                        <span className="diff-removed">
                          -{formatPanelNumber(turn.deletions)}
                        </span>
                      </small>
                    </span>
                  </PopoverItem>
                ))
            )}
          </PopoverMenu>
          <span className="review-sidebar-counts">
            <strong>+{formatPanelNumber(totals.additions)}</strong>
            <em>-{formatPanelNumber(totals.deletions)}</em>
          </span>
        </div>
        <div className="review-sidebar-actions">
          <Tooltip content="运行代码审查">
            <button
              aria-label="运行代码审查"
              className="message-action"
              disabled={sessionBusy}
              type="button"
              onClick={onRunCodeReview}
            >
              <Sparkles size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="搜索文件">
            <button
              aria-label="搜索文件"
              className="message-action"
              type="button"
              onClick={() => {
                const value = window.prompt("搜索文件路径", search);
                if (value !== null) setSearch(value);
              }}
            >
              <Search size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content={isRefreshing ? "刷新中..." : "刷新变更"}>
            <button
              aria-label="刷新变更"
              className="message-action"
              disabled={isRefreshing}
              type="button"
              onClick={onRefreshDiff}
            >
              <RotateCcw size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="打开工作区">
            <button
              aria-label="打开工作区"
              className="message-action"
              disabled={!workspacePath}
              type="button"
              onClick={onOpenWorkspacePath}
            >
              <FolderOpen size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <PopoverMenu
            align="end"
            className="popover-review-filter"
            open={filterMenuOpen}
            sideOffset={4}
            trigger={
              <Tooltip content="筛选">
                <button
                  aria-label="筛选"
                  aria-pressed={filter !== "all"}
                  className="message-action"
                  type="button"
                >
                  <Filter size={APP_ICON_SIZE} />
                </button>
              </Tooltip>
            }
            onOpenChange={setFilterMenuOpen}
          >
            <PopoverItem
              selected={filter === "all"}
              withCheck
              onClick={() => {
                setFilter("all");
                setFilterMenuOpen(false);
              }}
            >
              全部
            </PopoverItem>
            <PopoverItem
              selected={filter === "added"}
              withCheck
              onClick={() => {
                setFilter("added");
                setFilterMenuOpen(false);
              }}
            >
              新增
            </PopoverItem>
            <PopoverItem
              selected={filter === "modified"}
              withCheck
              onClick={() => {
                setFilter("modified");
                setFilterMenuOpen(false);
              }}
            >
              修改
            </PopoverItem>
            <PopoverItem
              selected={filter === "removed"}
              withCheck
              onClick={() => {
                setFilter("removed");
                setFilterMenuOpen(false);
              }}
            >
              删除
            </PopoverItem>
          </PopoverMenu>
          <Tooltip
            content={
              reviewView === "inline" ? "行内视图（只读）" : "分离视图（只读）"
            }
          >
            <button
              aria-label="审阅视图（只读）"
              className="message-action"
              type="button"
            >
              {reviewView === "inline" ? (
                <Sliders size={APP_ICON_SIZE} />
              ) : (
                <Columns2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              )}
            </button>
          </Tooltip>
          <Tooltip content="关闭右侧边栏">
            <button
              aria-label="关闭右侧边栏"
              className="message-action"
              type="button"
              onClick={onClose}
            >
              <PanelRight size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
        </div>
      </div>

      {selectedTurn || lastUserMessage || totalChangedFiles > 0 ? (
        <div
          className="review-sidebar-context"
          title={
            selectedTurn
              ? selectedTurn.userMessageText
              : "全部轮次（累积变更）"
          }
        >
          <Eye size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <span>
            {selectedTurn
              ? `第 ${turns.findIndex((t) => t.id === selectedTurn.id) + 1} 轮 · ${truncateToWidth(selectedTurn.userMessageText, 60)}`
              : `全部轮次 · 累积 ${formatPanelNumber(totalChangedFiles)} 个文件变更`}
          </span>
        </div>
      ) : null}

      {selectedFile ? (
        <ReviewDiffPreview
          file={selectedFile}
          view={reviewView}
          workspacePath={workspacePath}
        />
      ) : null}

      <div className="review-file-list" role="list">
        {visibleFiles.length > 0 ? (
          visibleFiles.map((file) => (
            <button
              className={`review-file-row ${
                file.path === selectedFile?.path ? "active" : ""
              }`}
              key={file.path}
              title={file.path}
              type="button"
              onClick={() => setSelectedPath(file.path)}
            >
              <span className="review-file-badge">{fileBadge(file.path)}</span>
              <span className="review-file-path">{file.path}</span>
              <span className="review-file-counts">
                <strong>+{formatPanelNumber(file.additions)}</strong>
                <em>-{formatPanelNumber(file.deletions)}</em>
              </span>
            </button>
          ))
        ) : (
          <div className="review-empty-state">
            {files.length === 0
              ? "暂无文件变更。"
              : "当前筛选下没有匹配的文件。"}
          </div>
        )}
      </div>
    </aside>
  );
}

function ReviewDiffPreview({
  file,
  view,
  workspacePath,
}: {
  file: ReviewFile;
  view: DesktopReviewView;
  workspacePath: string | null;
}): React.ReactNode {
  return (
    <section className="review-diff-preview" aria-label={`${file.path} diff`}>
      <div className="review-file-row active preview-header">
        <span className="review-file-badge">{fileBadge(file.path)}</span>
        <span className="review-file-path">{file.path}</span>
        <span className="review-file-counts">
          <strong>+{formatPanelNumber(file.additions)}</strong>
          <em>-{formatPanelNumber(file.deletions)}</em>
        </span>
        <Tooltip content="在文件管理器中打开">
          <button
            aria-label="在文件管理器中打开"
            className="message-action review-file-open"
            disabled={!workspacePath}
            type="button"
            onClick={() => {
              if (!workspacePath) return;
              void desktopClient.openPathWithDefaultTarget(
                `${workspacePath}/${file.path}`,
              );
            }}
          >
            <ExternalLink size={APP_ICON_SIZE} />
          </button>
        </Tooltip>
      </div>
      {file.lines.length > 0 ? (
        view === "split" ? (
          <ReviewDiffSplit lines={file.lines} />
        ) : (
          <ReviewDiffInline lines={file.lines} />
        )
      ) : (
        <div className="review-empty-state">
          {file.isUntracked
            ? "未跟踪文件尚无可用 diff 预览。"
            : "此文件没有可用的 tracked diff。"}
        </div>
      )}
    </section>
  );
}

function ReviewDiffInline({ lines }: { lines: ReviewDiffLine[] }): React.ReactNode {
  return (
    <div className="review-diff-lines review-diff-inline">
      {lines.map((line) => {
        if (line.type === "meta") {
          return (
            <div className={`review-diff-row ${line.type}`} key={line.id}>
              <span className="review-diff-line-content">{line.content}</span>
            </div>
          );
        }
        if (line.type === "hunk") {
          return (
            <React.Fragment key={line.id}>
              {line.unmodifiedBefore && line.unmodifiedBefore > 0 ? (
                <div className="review-diff-unmodified">
                  {line.unmodifiedBefore} unmodified lines
                </div>
              ) : null}
              <div className={`review-diff-row ${line.type}`}>
                <span className="review-diff-line-content">{line.content}</span>
              </div>
            </React.Fragment>
          );
        }
        const lineNumber =
          line.type === "added" ? line.newLine : line.oldLine;
        return (
          <div className={`review-diff-row ${line.type}`} key={line.id}>
            <span
              className={`review-diff-line-number ${
                line.type === "added"
                  ? "added"
                  : line.type === "removed"
                    ? "removed"
                    : ""
              }`}
            >
              {lineNumber ?? ""}
            </span>
            <code className="review-diff-line-content">
              {line.content || " "}
            </code>
          </div>
        );
      })}
    </div>
  );
}

function ReviewDiffSplit({ lines }: { lines: ReviewDiffLine[] }): React.ReactNode {
  const rows = React.useMemo(() => splitDiffLines(lines), [lines]);
  return (
    <div className="review-diff-lines review-diff-split">
      {rows.map((row) => {
        if (row.hunk) {
          return (
            <div className="review-diff-row hunk" key={row.id}>
              <span className="review-diff-line-content">{row.hunk.content}</span>
            </div>
          );
        }
        if (row.meta) {
          return (
            <div className="review-diff-row meta" key={row.id}>
              <span className="review-diff-line-content">{row.meta.content}</span>
            </div>
          );
        }
        return (
          <React.Fragment key={row.id}>
            {row.unmodifiedBefore && row.unmodifiedBefore > 0 ? (
              <div className="review-diff-unmodified">
                {row.unmodifiedBefore} unmodified lines
              </div>
            ) : null}
            <div
              className={`review-diff-split-row ${
                row.paired ? "paired" : "single"
              }`}
            >
              <div
                className={`review-diff-side ${row.left.tone}`}
                data-tone={row.left.tone}
              >
                <span
                  className={`review-diff-line-number ${
                    row.left.tone === "removed" ? "removed" : ""
                  }`}
                >
                  {row.left.number ?? ""}
                </span>
                <code className="review-diff-line-content">
                  {row.left.tone === "empty" ? " " : row.left.content}
                </code>
              </div>
              <div
                className={`review-diff-side ${row.right.tone}`}
                data-tone={row.right.tone}
              >
                <span
                  className={`review-diff-line-number ${
                    row.right.tone === "added" ? "added" : ""
                  }`}
                >
                  {row.right.number ?? ""}
                </span>
                <code className="review-diff-line-content">
                  {row.right.tone === "empty" ? " " : row.right.content}
                </code>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function buildReviewFiles(
  diff: string,
  gitStatus: DesktopGitStatus | null,
): ReviewFile[] {
  const parsedFiles = parseWorkspaceDiffFiles(diff);
  const parsedByPath = new Map(parsedFiles.map((file) => [file.path, file]));
  const statusFiles = gitStatus?.files ?? [];

  if (statusFiles.length > 0) {
    return statusFiles.map((file) => {
      const parsed = parsedByPath.get(file.path);
      return {
        path: file.path,
        originalPath: file.originalPath,
        status: file.status,
        additions: file.additions ?? parsed?.additions ?? 0,
        deletions: file.deletions ?? parsed?.deletions ?? 0,
        isUntracked: file.isUntracked,
        lines: parsed?.lines ?? [],
      };
    });
  }

  return parsedFiles;
}

function parseWorkspaceDiffFiles(diff: string): ReviewFile[] {
  const files: ReviewFile[] = [];
  let current: ReviewFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  let lineId = 0;
  let expectedNewLine = 0;
  let expectedOldLine = 0;

  function pushCurrent(): void {
    if (current) {
      files.push(current);
    }
  }

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      pushCurrent();
      current = {
        path: parseDiffPath(rawLine),
        status: " M",
        additions: 0,
        deletions: 0,
        isUntracked: false,
        lines: [],
      };
      oldLine = 0;
      newLine = 0;
      lineId = 0;
      expectedNewLine = 0;
      expectedOldLine = 0;
      continue;
    }

    if (!current) continue;

    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunkMatch) {
      const hunkOldStart = Number(hunkMatch[1]);
      const hunkNewStart = Number(hunkMatch[2]);
      const skipped = Math.max(0, hunkNewStart - expectedNewLine - 1);
      oldLine = hunkOldStart;
      newLine = hunkNewStart;
      current.lines.push({
        id: `${current.path}-${lineId++}`,
        type: "hunk",
        oldLine: null,
        newLine: null,
        content: rawLine,
        unmodifiedBefore: skipped,
      });
      expectedOldLine = hunkOldStart;
      expectedNewLine = hunkNewStart;
      continue;
    }

    if (
      rawLine.startsWith("index ") ||
      rawLine.startsWith("new file mode ") ||
      rawLine.startsWith("deleted file mode ") ||
      rawLine.startsWith("similarity index ") ||
      rawLine.startsWith("rename from ") ||
      rawLine.startsWith("rename to ") ||
      rawLine.startsWith("--- ") ||
      rawLine.startsWith("+++ ")
    ) {
      current.lines.push({
        id: `${current.path}-${lineId++}`,
        type: "meta",
        oldLine: null,
        newLine: null,
        content: rawLine,
      });
      continue;
    }

    if (rawLine.startsWith("+")) {
      current.additions += 1;
      current.lines.push({
        id: `${current.path}-${lineId++}`,
        type: "added",
        oldLine: null,
        newLine,
        content: rawLine,
      });
      newLine += 1;
      expectedNewLine = newLine;
      continue;
    }

    if (rawLine.startsWith("-")) {
      current.deletions += 1;
      current.lines.push({
        id: `${current.path}-${lineId++}`,
        type: "removed",
        oldLine,
        newLine: null,
        content: rawLine,
      });
      oldLine += 1;
      expectedOldLine = oldLine;
      continue;
    }

    if (rawLine.startsWith(" ")) {
      current.lines.push({
        id: `${current.path}-${lineId++}`,
        type: "context",
        oldLine,
        newLine,
        content: rawLine,
      });
      oldLine += 1;
      newLine += 1;
      expectedOldLine = oldLine;
      expectedNewLine = newLine;
      continue;
    }

    if (rawLine.trim()) {
      current.lines.push({
        id: `${current.path}-${lineId++}`,
        type: "meta",
        oldLine: null,
        newLine: null,
        content: rawLine,
      });
    }
  }

  pushCurrent();
  return files;
}

function splitDiffLines(lines: ReviewDiffLine[]): ReviewSplitRow[] {
  const rows: ReviewSplitRow[] = [];
  const pending: ReviewDiffLine[] = [];

  function flushPending(): void {
    if (pending.length === 0) return;
    if (pending.length === 1) {
      const removed = pending[0];
      rows.push({
        id: `${removed.id}-split`,
        left: {
          number: removed.oldLine,
          content: stripDiffPrefix(removed.content),
          tone: "removed",
        },
        right: { number: null, content: "", tone: "empty" },
        paired: false,
      });
    } else {
      const leftCount = pending.filter((p) => p.type === "removed").length;
      const rightCount = pending.filter((p) => p.type === "added").length;
      const paired = leftCount === rightCount && leftCount > 0;
      if (paired) {
        const removedParts = pending.filter((p) => p.type === "removed");
        const addedParts = pending.filter((p) => p.type === "added");
        for (let i = 0; i < leftCount; i += 1) {
          rows.push({
            id: `${pending[0].id}-split-${i}`,
            left: {
              number: removedParts[i]?.oldLine ?? null,
              content: removedParts[i]
                ? stripDiffPrefix(removedParts[i].content)
                : "",
              tone: "removed",
            },
            right: {
              number: addedParts[i]?.newLine ?? null,
              content: addedParts[i]
                ? stripDiffPrefix(addedParts[i].content)
                : "",
              tone: "added",
            },
            paired: true,
          });
        }
      } else {
        for (const part of pending) {
          if (part.type === "removed") {
            rows.push({
              id: `${part.id}-split`,
              left: {
                number: part.oldLine,
                content: stripDiffPrefix(part.content),
                tone: "removed",
              },
              right: { number: null, content: "", tone: "empty" },
              paired: false,
            });
          } else if (part.type === "added") {
            rows.push({
              id: `${part.id}-split`,
              left: { number: null, content: "", tone: "empty" },
              right: {
                number: part.newLine,
                content: stripDiffPrefix(part.content),
                tone: "added",
              },
              paired: false,
            });
          }
        }
      }
    }
    pending.length = 0;
  }

  for (const line of lines) {
    if (line.type === "hunk") {
      flushPending();
      rows.push({
        id: `${line.id}-split`,
        hunk: { content: line.content },
        left: { number: null, content: "", tone: "empty" },
        right: { number: null, content: "", tone: "empty" },
        paired: false,
        unmodifiedBefore: line.unmodifiedBefore,
      });
      continue;
    }
    if (line.type === "meta") {
      flushPending();
      rows.push({
        id: `${line.id}-split`,
        meta: { content: line.content },
        left: { number: null, content: "", tone: "empty" },
        right: { number: null, content: "", tone: "empty" },
        paired: false,
      });
      continue;
    }
    if (line.type === "context") {
      flushPending();
      rows.push({
        id: `${line.id}-split`,
        left: {
          number: line.oldLine,
          content: stripDiffPrefix(line.content),
          tone: "context",
        },
        right: {
          number: line.newLine,
          content: stripDiffPrefix(line.content),
          tone: "context",
        },
        paired: false,
      });
      continue;
    }
    pending.push(line);
  }
  flushPending();
  return rows;
}

function stripDiffPrefix(content: string): string {
  if (content.length === 0) return content;
  const prefix = content[0];
  if (prefix === "+" || prefix === "-" || prefix === " ") {
    return content.slice(1);
  }
  return content;
}

function truncateToWidth(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

function parseDiffPath(line: string): string {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  return match?.[2] ?? line.replace(/^diff --git\s+/, "").trim();
}

function fileBadge(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  if (!extension) return "FILE";
  return extension.slice(0, 4).toUpperCase();
}

function EnvironmentPanel({
  branchName,
  diff,
  gitStatus,
  workspacePath,
  onCommitOrPush,
  onCreateBranch,
  onCreatePullRequest,
  onOpenWorkspacePath,
  onRefreshDiff,
}: {
  branchName: string | null;
  diff: string;
  gitStatus: DesktopGitStatus | null;
  workspacePath: string | null;
  onCommitOrPush: () => void;
  onCreateBranch: () => void;
  onCreatePullRequest: () => void;
  onOpenWorkspacePath: () => void;
  onRefreshDiff: () => void;
}): React.ReactNode {
  const [showDiff, setShowDiff] = React.useState(false);
  const diffSummary = summarizeDiff(diff);
  const gitLabel = branchName?.trim() || "未检测到 Git 分支";
  const changedFileCount = gitStatus?.files.length ?? 0;

  return (
    <aside className="environment-panel" aria-label="环境信息">
      <div className="environment-panel-header">
        <span>环境信息</span>
        <button aria-label="环境设置" className="message-action" type="button">
          <Settings size={APP_ICON_SIZE} />
        </button>
      </div>

      <div className="environment-action-list">
        <button
          className="environment-action-row"
          type="button"
          onClick={() => {
            onRefreshDiff();
            setShowDiff((current) => !current);
          }}
        >
          <FileDiff size={APP_ICON_SIZE} />
          <span>变更{changedFileCount ? ` (${changedFileCount})` : ""}</span>
          <span className="environment-diff-counts">
            <strong>+{formatPanelNumber(diffSummary.additions)}</strong>
            <em>-{formatPanelNumber(diffSummary.deletions)}</em>
          </span>
        </button>
        {showDiff ? <pre className="environment-diff-preview">{diff}</pre> : null}
        <button
          className="environment-action-row"
          type="button"
          onClick={onOpenWorkspacePath}
        >
          <Laptop size={APP_ICON_SIZE} />
          <span>本地</span>
          <ChevronRight className="environment-row-chevron" size={APP_ICON_SIZE} />
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCreateBranch}
        >
          <GitBranch size={APP_ICON_SIZE} />
          <span title={gitLabel}>{gitLabel}</span>
          <ChevronRight className="environment-row-chevron" size={APP_ICON_SIZE} />
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCommitOrPush}
        >
          <Upload size={APP_ICON_SIZE} />
          <span>提交或推送</span>
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCreatePullRequest}
        >
          <GitPullRequest size={APP_ICON_SIZE} />
          <span>创建拉取请求</span>
        </button>
      </div>

      <div className="environment-source">
        <span>来源</span>
        <small title={workspacePath ?? undefined}>
          {workspacePath ? "本地项目" : "暂无来源"}
        </small>
      </div>
    </aside>
  );
}

function foldTimelineEvents(
  sourceEvents: DesktopSessionEvent[],
): DesktopSessionEvent[] {
  const folded: DesktopSessionEvent[] = [];
  for (const event of sourceEvents) {
    const previous = folded.at(-1);
    if (event.type === "assistant_delta") {
      if (previous?.type === "assistant_delta") {
        folded[folded.length - 1] = event;
      } else {
        folded.push(event);
      }
      continue;
    }
    if (
      event.type === "message" &&
      event.role === "assistant" &&
      previous?.type === "assistant_delta"
    ) {
      folded[folded.length - 1] = event;
      continue;
    }
    folded.push(event);
  }
  return folded;
}

export function groupTimelineToolEvents(
  sourceEvents: DesktopSessionEvent[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let pendingToolEvents: DesktopSessionEvent[] = [];

  function flushToolEvents(): void {
    if (pendingToolEvents.length === 0) return;
    const group = buildToolGroup(pendingToolEvents);
    if (group) {
      items.push(group);
    }
    pendingToolEvents = [];
  }

  for (const event of sourceEvents) {
    if (event.type === "status") {
      continue;
    }
    if (
      event.type === "tool_call" ||
      event.type === "tool_result" ||
      event.type === "permission_request"
    ) {
      pendingToolEvents.push(event);
      continue;
    }
    flushToolEvents();
    items.push(event);
  }

  flushToolEvents();
  return items;
}

function buildToolGroup(events: DesktopSessionEvent[]): TimelineToolGroup | null {
  const runs: TimelineToolRun[] = [];

  for (const event of events) {
    const toolName = stringMetadata(event, "toolName") ?? "Tool";
    const toolUseId = toolUseIdForEvent(event);
    const content = normalizedToolContent(event, toolName);

    if (event.type === "tool_call") {
      runs.push({
        id: event.id,
        toolUseId,
        toolName,
        callContent: content,
        resultContent: "",
        isError: false,
        isRunning: true,
        isWaitingForPermission: false,
        startedAtMs: Date.parse(event.createdAt) || undefined,
      });
      continue;
    }

    const pendingRun =
      (toolUseId ? findPendingToolRun(runs, undefined, toolUseId) : null) ??
      findPendingToolRun(runs, toolName) ??
      findPendingToolRun(runs);
    if (event.type === "permission_request") {
      if (pendingRun) {
        pendingRun.isWaitingForPermission = true;
      }
      continue;
    }
    if (pendingRun) {
      pendingRun.resultContent = content;
      pendingRun.isError = event.metadata?.isError === true;
      pendingRun.isRunning = false;
      pendingRun.isWaitingForPermission = false;
      continue;
    }

    if (!content && event.metadata?.isError !== true) {
      continue;
    }
    runs.push({
      id: event.id,
      toolUseId,
      toolName,
      callContent: "",
      resultContent: content,
      isError: event.metadata?.isError === true,
      isRunning: false,
      isWaitingForPermission: false,
    });
  }

  const visibleRuns = runs.filter(
    (run) =>
      run.callContent ||
      run.resultContent ||
      run.isError ||
      run.isRunning,
  );

  if (visibleRuns.length === 0) return null;

  return {
    id: `tool-group-${events[0]?.id ?? "empty"}`,
    type: "tool_group",
    runs: visibleRuns,
  };
}

function findPendingToolRun(
  runs: TimelineToolRun[],
  toolName?: string,
  toolUseId?: string,
): TimelineToolRun | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!run || !run.isRunning) continue;
    if (toolUseId && run.toolUseId !== toolUseId) continue;
    if (toolName && run.toolName !== toolName) continue;
    return run;
  }
  return null;
}

function stringMetadata(
  event: DesktopSessionEvent,
  key: string,
): string | null {
  const value = event.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function numberMetadata(
  event: DesktopSessionEvent,
  key: string,
): number | null {
  const value = event.metadata?.[key];
  return typeof value === "number" ? value : null;
}

function toolUseIdForEvent(event: DesktopSessionEvent): string | undefined {
  const metadataToolUseId =
    stringMetadata(event, "toolUseId") ?? stringMetadata(event, "tool_use_id");
  if (metadataToolUseId) return metadataToolUseId;
  const directToolUseId = (event as { toolUseId?: unknown }).toolUseId;
  return typeof directToolUseId === "string" ? directToolUseId : undefined;
}

function displayToolName(toolName: string): string {
  return toolName === "Bash" ? "Shell" : toolName;
}

function normalizedToolContent(
  event: DesktopSessionEvent,
  toolName: string,
): string {
  const content = event.content?.trim() ?? "";
  if (!content) return "";
  if (event.type === "tool_result" && content === toolName) return "";
  const prefix = `${toolName}:`;
  return content.startsWith(prefix) ? content.slice(prefix.length).trim() : content;
}

function summarizeDiff(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function formatPanelNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function ThinkingPill(): React.ReactNode {
  return (
    <div aria-live="polite" className="chat-thinking-pill" role="status">
      <Sparkles size={APP_ICON_SIZE} />
      <span>正在思考</span>
    </div>
  );
}
