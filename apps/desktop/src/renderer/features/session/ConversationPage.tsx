import React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
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
  Globe,
  Laptop,
  MessageSquarePlus,
  MoreHorizontal,
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
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import { legacyMessagesToSessionEvents } from "../../../shared/sessionEventModel.js";
import { deriveWorkflowSessionState } from "../../../shared/workflowReducer.js";
import type {
  DesktopDiffMarkerStyle,
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
import { InlineApprovalCard } from "./InlineApprovalCard.js";
import { WorkflowPlanCard, planTitleFromSummary } from "./WorkflowPlanCard.js";
import { parseAskUserQuestions } from "./AskUserQuestionApproval.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { ComposerSurface } from "./ComposerSurface.js";
import {
  clearConversationSelectionHighlight,
  createConversationSelectionSnapshot,
  installConversationSelectionHighlight,
} from "./conversationSelectionHighlight.js";
import { useTypewriterText } from "./TypewriterText.js";
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import { Tooltip } from "../../components/ui/Tooltip.js";
import { ScrollArea } from "../../components/ui/ScrollArea.js";
import {
  loadConversationUiState,
  saveConversationUiState,
} from "../layout/conversationUiState.js";
import { SessionTimelineView } from "./SessionTimelineView.js";
import { ConversationTurnNavRail } from "./ConversationTurnNavRail.js";

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

const DEBUG_ASK_USER_QUESTION_REQUEST_ID_PREFIX = "debug-ask-user-question";

function useElapsedSeconds(
  startTimeMs: number | undefined,
  isRunning: boolean,
): number {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    if (!isRunning || !startTimeMs) {
      setSeconds(0);
      return;
    }
    const tick = () =>
      setSeconds(Math.floor((Date.now() - startTimeMs) / 1000));
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
    onOpenPlanInRightDock,
    onAppendComposerText,
    onAppendSideChatText,
    permissionMode,
    pendingPermissions,
    composer,
    rightDockOpen,
    rightDockTool,
    rightDockPlanContent,
    rightDockNode,
    rightDockWidth,
    debugMode,
  } = useQuickChatContext();
  const {
    defaultOpenTargetId,
    setDefaultOpenTargetId,
    diffMarkerStyle,
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
  const timelineEvents = React.useMemo(() => {
    const sourceEvents = deriveTimelineSourceEvents({
      conversationMessages,
      events,
      sessionStatus,
      workflowEvents: workflowDerivedState.events,
    });
    return foldTimelineEvents(sourceEvents);
  }, [
    conversationMessages,
    events,
    sessionStatus,
    workflowDerivedState.events,
  ]);
  const timelineItems = React.useMemo(
    () => groupTimelineToolEvents(timelineEvents),
    [timelineEvents],
  );
  const phaseItems = React.useMemo(
    () => groupTimelineExecutionPhases(timelineItems, sessionStatus),
    [timelineItems, sessionStatus],
  );
  const turnNavItems = React.useMemo(
    () => deriveConversationTurnNavItems(phaseItems),
    [phaseItems],
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
  const [conversationSelectedText, setConversationSelectedText] =
    React.useState("");
  const [openTargetMenuOpen, setOpenTargetMenuOpen] = React.useState(false);
  const [environmentPopoverOpen, setEnvironmentPopoverOpen] =
    React.useState(false);
  const [openTargets, setOpenTargets] = React.useState<DesktopOpenTarget[]>(
    FALLBACK_OPEN_TARGETS,
  );
  const [showPinnedSummary, setShowPinnedSummary] = React.useState(true);
  const [debugAskUserQuestionRequest, setDebugAskUserQuestionRequest] =
    React.useState<DesktopPermissionRequest | null>(null);
  React.useEffect(() => {
    if (!debugMode || pendingPermissions.length > 0) {
      setDebugAskUserQuestionRequest(null);
    }
  }, [debugMode, pendingPermissions.length]);
  React.useEffect(() => {
    return () => {
      clearConversationSelectionHighlight();
    };
  }, []);
  const [isRefreshingDiff, setIsRefreshingDiff] = React.useState(false);
  const timelineListRef = React.useRef<import("virtua").VListHandle | null>(
    null,
  );
  const mainScrollTopRef = React.useRef(0);
  const scrollRestoredRef = React.useRef(false);

  const handleTimelineScroll = React.useCallback((scrollTop: number) => {
    mainScrollTopRef.current = scrollTop;
  }, []);

  React.useEffect(() => {
    const sessionId = activeSessionId;

    return () => {
      if (!sessionId || mainScrollTopRef.current <= 0) return;
      const existing = loadConversationUiState(sessionId);
      if (existing) {
        existing.mainScrollTop = mainScrollTopRef.current;
        saveConversationUiState(sessionId, existing);
      }
    };
  }, [activeSessionId]);

  React.useEffect(() => {
    if (isConversationLoading || !activeSessionId) return;
    if (scrollRestoredRef.current) return;
    const saved = loadConversationUiState(activeSessionId);
    if (saved?.mainScrollTop && timelineListRef.current) {
      scrollRestoredRef.current = true;
      requestAnimationFrame(() => {
        try {
          timelineListRef.current?.scrollTo(saved.mainScrollTop);
        } catch {
          // VList may not be ready yet; silently ignore
        }
      });
    }
  }, [isConversationLoading, activeSessionId]);

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
    onOpenRightDock("review");
    onRefreshDiff();
    void submitReviewAction({
      sessionId: activeSessionId,
      gitStatus,
      diff,
      model,
    });
  }, [activeSessionId, diff, gitStatus, model, onOpenRightDock, onRefreshDiff]);
  const handleDiscardChanges = React.useCallback(
    async (paths: string[], turnRestoreId?: string | null) => {
      if (!workspacePath) return;
      if (paths.length === 0) return;
      try {
        const result =
          turnRestoreId && activeSessionId
            ? await desktopClient.restoreSessionTurnChanges({
                sessionId: activeSessionId,
                turnRestoreId,
                paths,
              })
            : await desktopClient.discardWorkspaceChanges({
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
    [activeSessionId, onRefreshDiff, workspacePath],
  );
  const [workflowTimelineVisible, setWorkflowTimelineVisible] =
    React.useState(false);
  const showEnvironmentPanel = Boolean(
    workspacePath && showPinnedSummary && !rightDockOpen,
  );
  const showComposerChangeSummary = Boolean(
    workspacePath && gitStatus && gitStatus.files.length > 0,
  );
  const composerDiffSummary = React.useMemo(() => summarizeDiff(diff), [diff]);
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
  const activePermissionRequest =
    pendingPermissions[0] ?? debugAskUserQuestionRequest;
  const hasRealPendingPermission = pendingPermissions.length > 0;
  const composerMode = workflowComposerMode(activePermissionRequest);
  const composerTransition = useHeightTransition([
    composerMode,
    activePermissionRequest?.requestId ?? "",
    showComposerChangeSummary,
    composer ? "mounted" : "unmounted",
  ]);

  const workflowPageRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const composerEl = composerTransition.ref.current;
    const pageEl = workflowPageRef.current;
    if (!composerEl || !pageEl) return;

    let animationFrame = 0;
    let lastWidth = 0;

    const updateDimensions = (): void => {
      const rect = composerEl.getBoundingClientRect();
      if (Math.abs(rect.width - lastWidth) < 0.5) return;
      lastWidth = rect.width;
      pageEl.style.setProperty("--workflow-composer-width", `${rect.width}px`);
    };

    const scheduleUpdateDimensions = (): void => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        updateDimensions();
      });
    };

    updateDimensions();

    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(scheduleUpdateDimensions);
      observer.observe(composerEl);
    } catch {
      // ResizeObserver not available; CSS fallback handles dimension variables
    }

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      observer?.disconnect();
    };
  }, [composer, composerTransition.ref, workflowPageRef]);

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

  function openDebugAskUserQuestionCard(): void {
    if (hasRealPendingPermission) return;
    setDebugAskUserQuestionRequest(
      buildDebugAskUserQuestionRequest(String(Date.now())),
    );
  }

  function decideInlinePermission(
    request: DesktopPermissionRequest,
    behavior: "allow" | "deny",
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
    decisionExtras?: Parameters<typeof onDecidePermission>[4],
  ): void {
    if (isDebugAskUserQuestionRequest(request)) {
      setDebugAskUserQuestionRequest(null);
      if (updatedInput) {
        console.info("Debug AskUserQuestion submitted", updatedInput);
      }
      return;
    }
    onDecidePermission(
      request,
      behavior,
      alwaysAllow,
      updatedInput,
      decisionExtras,
    );
  }

  function openReviewSidebar(): void {
    onRefreshDiff();
    onOpenRightDock("review");
  }

  function handleConversationContextMenu(): void {
    clearConversationSelectionHighlight();
    const snapshot = createConversationSelectionSnapshot(window.getSelection());
    setConversationSelectedText(snapshot?.text ?? "");
    if (snapshot) {
      installConversationSelectionHighlight(snapshot.range);
    }
  }

  function handleAddToConversation(): void {
    const text = conversationSelectedText.trim();
    if (!text) return;
    onAppendComposerText(text);
    clearConversationSelectionHighlight();
    setConversationSelectedText("");
  }

  function handleAskInSideChat(): void {
    const text = conversationSelectedText.trim();
    if (!text) return;
    onAppendSideChatText(text);
    clearConversationSelectionHighlight();
    setConversationSelectedText("");
  }

  const showConversationContextMenu =
    conversationSelectedText.trim().length > 0;

  const workspaceHeaderTitle = React.useMemo(
    () => (
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
          <PopoverItem disabled icon={<AppWindow size={APP_ICON_SIZE} />}>
            在新窗口中打开
          </PopoverItem>
        </PopoverMenu>
      </div>
    ),
    [
      activeSessionId,
      hasActiveSession,
      isConversationLoading,
      isSessionPinned,
      renderedSessionTitle,
      sessionMenuOpen,
      workspacePath,
    ],
  );

  const workspaceHeaderActions = React.useMemo(
    () => (
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
                <ChevronDown
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
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
        <Tooltip content={showPinnedSummary ? "隐藏置顶摘要" : "显示置顶摘要"}>
          <button
            aria-label={showPinnedSummary ? "隐藏置顶摘要" : "显示置顶摘要"}
            aria-pressed={showPinnedSummary}
            className="message-action"
            disabled={!workspacePath}
            type="button"
            onClick={() => setShowPinnedSummary((current) => !current)}
          >
            <Columns2
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
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
            <Workflow
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </button>
        </Tooltip>
        {debugMode ? (
          <Tooltip
            content={
              hasRealPendingPermission
                ? "已有真实审批请求，不能打开 mock 卡片"
                : "弹出 AskUserQuestion 调试卡片"
            }
          >
            <button
              aria-label="弹出 AskUserQuestion 调试卡片"
              className="message-action"
              disabled={hasRealPendingPermission}
              type="button"
              onClick={openDebugAskUserQuestionCard}
            >
              <MessageSquarePlus
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </button>
          </Tooltip>
        ) : null}
        <PopoverMenu
          align="end"
          className="popover-environment"
          open={environmentPopoverOpen}
          sideOffset={4}
          trigger={
            <button
              aria-label="环境信息"
              className="message-action"
              disabled={!workspacePath}
              title="环境信息"
              type="button"
            >
              <Globe size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          }
          onOpenChange={setEnvironmentPopoverOpen}
        >
          <DropdownMenu.Label className="popover-item-label">
            环境信息
          </DropdownMenu.Label>
          <DropdownMenu.Separator />
          <PopoverItem
            icon={<FileDiff size={APP_ICON_SIZE} />}
            onClick={onRefreshDiff}
          >
            变更
            <span className="environment-diff-counts">
              <strong>
                +{formatPanelNumber(composerDiffSummary.additions)}
              </strong>
              <em>-{formatPanelNumber(composerDiffSummary.deletions)}</em>
            </span>
          </PopoverItem>
          <PopoverItem
            icon={<Laptop size={APP_ICON_SIZE} />}
            onClick={onOpenWorkspacePath}
          >
            本地
          </PopoverItem>
          <PopoverItem
            icon={<GitBranch size={APP_ICON_SIZE} />}
            onClick={onCreateBranch}
          >
            {branchName?.trim() || "未检测到 Git 分支"}
          </PopoverItem>
          <PopoverItem
            icon={<Upload size={APP_ICON_SIZE} />}
            onClick={onCommitOrPush}
          >
            提交或推送
          </PopoverItem>
          <PopoverItem
            icon={<GitPullRequest size={APP_ICON_SIZE} />}
            onClick={onCreatePullRequest}
          >
            创建拉取请求
          </PopoverItem>
        </PopoverMenu>
      </div>
    ),
    [
      branchName,
      composerDiffSummary,
      debugMode,
      defaultOpenTargetId,
      environmentPopoverOpen,
      hasActiveSession,
      hasRealPendingPermission,
      openTargetMenuOpen,
      openTargets,
      selectedOpenTarget,
      showPinnedSummary,
      workflowTimelineVisible,
      workspacePath,
    ],
  );

  return (
    <section
      ref={workflowPageRef}
      className={
        activePermissionRequest
          ? "conversation-page workflow-page approval-active"
          : "conversation-page workflow-page"
      }
    >
      <div
        className="workflow-page__body"
        style={
          rightDockNode || showEnvironmentPanel
            ? ({
                "--right-dock-current-w": rightDockNode
                  ? `${rightDockWidth}px`
                  : "368px",
              } as React.CSSProperties)
            : undefined
        }
      >
        <main className="workflow-page__main">
          <header
            className={
              rightDockOpen
                ? "chat-session-header"
                : "chat-session-header chat-session-header--dock-closed"
            }
          >
            {workspaceHeaderTitle}
            {workspaceHeaderActions}
          </header>
          <div className="workflow-main-scroll-area">
            <ContextMenu.Root
              onOpenChange={(open) => {
                if (!open) {
                  clearConversationSelectionHighlight();
                }
              }}
            >
              <ContextMenu.Trigger asChild>
                <div
                  className="session-timeline-wrapper"
                  onContextMenu={handleConversationContextMenu}
                >
                  <ConversationTurnNavRail
                    items={turnNavItems}
                    onNavigate={(rowIndex) => {
                      timelineListRef.current?.scrollToIndex(rowIndex, {
                        align: "center",
                      });
                    }}
                  />
                  {isConversationLoading ? (
                    <div className="assistant-thinking">加载对话中</div>
                  ) : (
                    <>
                      {workflowTimelineVisible ? (
                        <WorkflowDebugTimeline
                          activeSessionId={activeSessionId}
                          consistencyDiagnostics={
                            workflowConsistencyDiagnostics
                          }
                          diagnostics={workflowDerivedState.diagnostics}
                          events={workflowEvents}
                          workspacePath={workspacePath}
                        />
                      ) : null}
                      <SessionTimelineView
                        count={phaseItems.length + (showThinking ? 1 : 0) + 1}
                        scrollToBottom={
                          sessionStatus === "running" ||
                          sessionStatus === "waiting"
                        }
                        onScroll={handleTimelineScroll}
                        listRef={timelineListRef}
                      >
                        {phaseItems.map((item) => (
                          <div
                            className="session-turn-row"
                            data-component="session-turn"
                            data-slot={timelineItemSlot(item)}
                            key={item.id}
                          >
                            <TimelineItem
                              item={item}
                              rightDockPlanContent={rightDockPlanContent}
                              rightDockPlanOpen={
                                rightDockOpen && rightDockTool === "plan"
                              }
                              showActions={
                                item.type === "message" &&
                                item.role === "assistant" &&
                                assistantActionMessageIds.has(item.id)
                              }
                              onOpenPlanInRightDock={onOpenPlanInRightDock}
                              onDiscardChanges={(paths, turnRestoreId) =>
                                void handleDiscardChanges(paths, turnRestoreId)
                              }
                              onReviewCode={handleRunCodeReview}
                              onReviewFiles={openReviewSidebar}
                            />
                          </div>
                        ))}
                        {!isConversationLoading && showThinking ? (
                          <div
                            className="chat-thinking-pill session-turn-row"
                            data-component="session-turn"
                            data-slot="thinking"
                            role="status"
                            aria-live="polite"
                          >
                            <Sparkles
                              size={APP_ICON_SIZE}
                              strokeWidth={APP_ICON_STROKE_WIDTH}
                            />
                            <span>正在思考</span>
                          </div>
                        ) : null}
                        <div className="session-bottom-spacer" />
                      </SessionTimelineView>
                    </>
                  )}
                </div>
              </ContextMenu.Trigger>
              {showConversationContextMenu ? (
                <ContextMenu.Portal>
                  <ContextMenu.Content className="sidebar-context-menu-content">
                    <ContextMenu.Item
                      className="sidebar-context-menu-item"
                      onSelect={handleAddToConversation}
                    >
                      添加到对话
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      className="sidebar-context-menu-item"
                      onSelect={handleAskInSideChat}
                    >
                      在侧边聊天中提问
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              ) : null}
            </ContextMenu.Root>
          </div>

          {composer ? (
            <footer className="chat-composer workflow-page__composer">
              <ComposerSurface
                ref={composerTransition.ref}
                className="workflow-page__composer-inner"
                style={composerTransition.style}
              >
                {showComposerChangeSummary ? (
                  <div className="composer-change-summary">
                    <span>
                      {gitStatus?.files.length ?? 0} 个文件已更改
                      <strong>
                        {" "}
                        +{formatPanelNumber(composerDiffSummary.additions)}
                      </strong>
                      <em>
                        {" "}
                        -{formatPanelNumber(composerDiffSummary.deletions)}
                      </em>
                    </span>
                    <button type="button" onClick={handleRunCodeReview}>
                      审查
                    </button>
                  </div>
                ) : null}
                {activePermissionRequest ? (
                  <InlineApprovalCard
                    request={activePermissionRequest}
                    currentPermissionMode={permissionMode}
                    onDecide={decideInlinePermission}
                    onAcceptExitPlanMode={onAcceptExitPlanMode}
                  />
                ) : (
                  composer
                )}
              </ComposerSurface>
            </footer>
          ) : null}
        </main>
        {showEnvironmentPanel ? (
          <EnvironmentPanel
            branchName={branchName}
            diff={diff}
            gitStatus={gitStatus}
            workspacePath={workspacePath}
            onCommitOrPush={onCommitOrPush}
            onCreateBranch={onCreateBranch}
            onCreatePullRequest={onCreatePullRequest}
            onOpenWorkspacePath={onOpenWorkspacePath}
            onRefreshDiff={onRefreshDiff}
          />
        ) : (
          rightDockNode
        )}
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
              未完成工具:{" "}
              {diagnostics.missingToolResults.slice(0, 3).join(", ")}
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
          className="popover-surface popover popover-sub-content popover-auto-width"
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
      <img alt="" className="chat-open-target-icon" src={target.iconDataUrl} />
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
    if (
      type === "checkpoint" ||
      type === "error" ||
      type === "turn.interrupted"
    ) {
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

export function deriveTimelineSourceEvents({
  conversationMessages,
  events,
  sessionStatus,
  workflowEvents,
}: {
  conversationMessages: Message[];
  events: DesktopSessionEvent[];
  sessionStatus: DesktopSessionStatus;
  workflowEvents: DesktopSessionEvent[];
}): DesktopSessionEvent[] {
  if (isActiveSessionStatus(sessionStatus) && events.length > 0) {
    return events;
  }
  if (workflowEvents.length > 0) {
    return workflowEvents;
  }
  if (events.length > 0) {
    return events;
  }
  return legacyMessagesToSessionEvents("legacy", conversationMessages);
}

export function deriveAssistantActionMessageIds({
  sessionStatus,
  timelineEvents,
}: {
  sessionStatus: DesktopSessionStatus;
  timelineEvents: DesktopSessionEvent[];
}): Set<string> {
  const visibleIds = new Set<string>();
  let turnAssistantMessageId: string | null = null;

  const resetTurn = () => {
    turnAssistantMessageId = null;
  };

  const commitCompletedTurn = () => {
    if (!turnAssistantMessageId) return;
    visibleIds.add(turnAssistantMessageId);
    resetTurn();
  };

  for (const event of timelineEvents) {
    if (
      event.type === "message" &&
      event.role === "assistant" &&
      Boolean(event.content?.trim())
    ) {
      turnAssistantMessageId = event.id;
      continue;
    }
    if (event.type === "checkpoint" || event.type === "error") {
      commitCompletedTurn();
    }
  }

  if (!isActiveSessionStatus(sessionStatus)) {
    commitCompletedTurn();
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

export { planCardPresentation, planTitleFromSummary } from "./WorkflowPlanCard.js";

export type TimelineToolRun = {
  id: string;
  toolUseId?: string;
  toolName: string;
  callContent: string;
  resultContent: string;
  permissionRequest?: DesktopPermissionRequest;
  resultMetadata?: Record<string, unknown>;
  isError: boolean;
  isRunning: boolean;
  isWaitingForPermission: boolean;
  startedAtMs?: number;
};

export type TimelineToolGroup = {
  id: string;
  type: "tool_group";
  runs: TimelineToolRun[];
};

export type ExecutionPhaseGroup = {
  id: string;
  type: "execution_phase";
  items: TimelineItem[];
  isComplete: boolean;
};

export type PhaseTimelineItem = TimelineItem | ExecutionPhaseGroup;

export type TimelineItem = DesktopSessionEvent | TimelineToolGroup;

/* ── Turn navigation model ─────────────────────────────── */

export type ConversationTurnNavItem = {
  id: string;
  rowIndex: number;
  userText: string;
  assistantText: string | null;
  files: string[];
};

/**
 * Derive turn-navigation items from phaseItems.
 * A "turn" starts at each user message.  For every turn we collect:
 *   – userText: the user's message content
 *   – assistantText: the last assistant message text in the turn (or null)
 *   – files: paths from file_patch events with metadata.turnScoped === true
 * The rowIndex is the index of the user message within phaseItems,
 * which also serves as the VList row index.
 */
export function deriveConversationTurnNavItems(
  items: PhaseTimelineItem[],
): ConversationTurnNavItem[] {
  const navItems: ConversationTurnNavItem[] = [];
  let currentId = "";
  let currentIndex = -1;
  let currentUserText = "";
  let currentAssistantText: string | null = null;
  const currentFilesSet = new Set<string>();

  function flushTurn(): void {
    if (currentIndex < 0) return;
    navItems.push({
      id: currentId,
      rowIndex: currentIndex,
      userText: currentUserText,
      assistantText: currentAssistantText,
      files: [...currentFilesSet],
    });
    currentId = "";
    currentIndex = -1;
    currentUserText = "";
    currentAssistantText = null;
    currentFilesSet.clear();
  }

  function collectEvent(event: DesktopSessionEvent): void {
    if (
      (event.type === "message" || event.type === "assistant_delta") &&
      event.role === "assistant"
    ) {
      if (event.content?.trim()) {
        currentAssistantText = event.content.trim();
      }
      return;
    }
    if (event.type === "file_patch" && event.metadata?.turnScoped === true) {
      collectFilesFromPatchEvent(event, currentFilesSet);
    }
  }

  function collectItemsRecursive(phaseItem: TimelineItem): void {
    if (phaseItem.type === "tool_group") {
      // Tool groups don't contain user messages or file_patches we care about here
      return;
    }
    collectEvent(phaseItem as DesktopSessionEvent);
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.type === "execution_phase") {
      // If we have an open turn, collect from inside the phase
      if (currentIndex >= 0) {
        for (const child of item.items) {
          collectItemsRecursive(child);
        }
      }
      continue;
    }

    const event = item as DesktopSessionEvent;

    // User message → start new turn
    if (event.type === "message" && event.role === "user") {
      flushTurn();
      currentId = event.id;
      currentIndex = i;
      currentUserText = event.content?.trim() ?? "";
      continue;
    }

    // Everything else collected into current turn
    if (currentIndex >= 0) {
      collectItemsRecursive(item);
    }
  }

  // Flush final turn
  flushTurn();

  return navItems;
}

function collectFilesFromPatchEvent(
  event: DesktopSessionEvent,
  fileSet: Set<string>,
): void {
  const meta = event.metadata ?? {};
  const files = Array.isArray(meta.files)
    ? (meta.files as Array<Record<string, unknown>>)
    : [];

  if (files.length > 0) {
    for (const file of files) {
      const path = file.path;
      if (typeof path === "string") {
        fileSet.add(path);
      }
    }
    return;
  }

  // Fallback to single filePath
  const filePath = meta.filePath;
  if (typeof filePath === "string") {
    fileSet.add(filePath);
  }
}

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

function timelineItemSlot(item: PhaseTimelineItem): string {
  if (item.type === "message" || item.type === "assistant_delta") {
    return `${item.role ?? "system"}-message`;
  }
  return item.type;
}

function TimelineItem({
  item,
  rightDockPlanContent,
  rightDockPlanOpen,
  showActions,
  onOpenPlanInRightDock,
  onReviewFiles,
  onReviewCode,
  onDiscardChanges,
}: {
  item: PhaseTimelineItem;
  rightDockPlanContent: string | null;
  rightDockPlanOpen: boolean;
  showActions: boolean;
  onOpenPlanInRightDock: (plan: { title: string; content: string }) => void;
  onReviewFiles: () => void;
  onReviewCode: () => void;
  onDiscardChanges: (paths: string[], turnRestoreId?: string | null) => void;
}): React.ReactNode {
  if (item.type === "execution_phase") {
    return (
      <ExecutionPhaseView
        phase={item}
        onOpenPlanInRightDock={onOpenPlanInRightDock}
        onDiscardChanges={onDiscardChanges}
        onReviewCode={onReviewCode}
        onReviewFiles={onReviewFiles}
      />
    );
  }
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
    if (!summary) return null;
    const title = planTitleFromSummary(summary);
    return (
      <article className="chat-message-row assistant">
        <div className="assistant-message-body">
          <WorkflowPlanCard
            summary={summary}
            streaming={event.metadata?.streaming === true}
            isDocked={rightDockPlanOpen && rightDockPlanContent === summary}
            onOpenInRightDock={() =>
              onOpenPlanInRightDock({ title, content: summary })
            }
          />
        </div>
      </article>
    );
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
      additions ??
      files.reduce((total, file) => total + Number(file.additions ?? 0), 0);
    const totalDeletions =
      deletions ??
      files.reduce((total, file) => total + Number(file.deletions ?? 0), 0);
    const filePaths = files
      .map((file) => (typeof file.path === "string" ? file.path : null))
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
    const turnRestoreId =
      typeof event.metadata?.turnRestoreId === "string"
        ? (event.metadata.turnRestoreId as string)
        : null;
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
                <span className="diff-added">
                  +{formatPanelNumber(totalAdditions)}
                </span>
                <span className="diff-removed">
                  -{formatPanelNumber(totalDeletions)}
                </span>
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
                if (
                  window.confirm(
                    `确认恢复 ${discardPaths.length} 个文件到本轮对话开始前的状态？`,
                  )
                ) {
                  onDiscardChanges(discardPaths, turnRestoreId);
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
  const questionResultCount = group.runs
    .map((run) => parseAskUserQuestionTimelineResult(run)?.count ?? 0)
    .reduce((total, count) => total + count, 0);
  const onlyQuestionResults =
    questionResultCount > 0 &&
    group.runs.every((run) => run.toolName === "AskUserQuestion");
  const groupElapsed = useElapsedSeconds(
    firstRunningRun?.startedAtMs,
    Boolean(firstRunningRun),
  );
  const groupSummaryLabel = firstRunningRun
    ? `正在运行命令，已持续 ${groupElapsed} s`
    : onlyQuestionResults
      ? `已询问 ${questionResultCount} 个问题`
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
        <span>{groupSummaryLabel}</span>
        <ChevronDown
          className="timeline-command-group-chevron"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </button>
      <div aria-hidden={!expanded} className="timeline-command-details">
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

function ExecutionPhaseView({
  phase,
  onOpenPlanInRightDock,
  onDiscardChanges,
  onReviewCode,
  onReviewFiles,
}: {
  phase: ExecutionPhaseGroup;
  onOpenPlanInRightDock: (plan: { title: string; content: string }) => void;
  onDiscardChanges: (paths: string[], turnRestoreId?: string | null) => void;
  onReviewCode: () => void;
  onReviewFiles: () => void;
}): React.ReactNode {
  const [expanded, setExpanded] = React.useState(!phase.isComplete);

  // Auto-expand while running
  React.useEffect(() => {
    if (!phase.isComplete && !expanded) {
      setExpanded(true);
    }
  }, [phase.isComplete, expanded]);

  return (
    <article
      className={
        expanded
          ? "execution-phase execution-phase--expanded"
          : "execution-phase"
      }
    >
      <button
        aria-expanded={expanded}
        className="execution-phase-summary"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        <Code2 size={APP_ICON_SIZE} />
        <span>{phase.isComplete ? "已处理" : "正在处理"}</span>
        <ChevronDown
          className="execution-phase-chevron"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </button>
      <div aria-hidden={!expanded} className="execution-phase-details">
        <div className="execution-phase-details-inner">
          {phase.items.map((childItem) => (
            <TimelineItem
              item={childItem}
              key={childItem.id}
              rightDockPlanContent={null}
              rightDockPlanOpen={false}
              showActions={false}
              onOpenPlanInRightDock={onOpenPlanInRightDock}
              onDiscardChanges={onDiscardChanges}
              onReviewCode={onReviewCode}
              onReviewFiles={onReviewFiles}
            />
          ))}
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

type AskUserQuestionTimelineResult = {
  count: number;
  items: Array<{
    question: string;
    answer: string;
  }>;
};

export function parseAskUserQuestionTimelineResult(
  run: TimelineToolRun,
): AskUserQuestionTimelineResult | null {
  if (run.toolName !== "AskUserQuestion") return null;
  const input = run.permissionRequest?.input;
  if (!input) return null;
  const questions = parseAskUserQuestions(input);
  if (!questions) return null;
  const answers = answersFromAskUserQuestionResult(run.resultMetadata);
  if (!answers) return null;
  const items = questions
    .map((question) => {
      const answer = answers[question.question];
      return typeof answer === "string" && answer.trim()
        ? { question: question.question, answer: answer.trim() }
        : null;
    })
    .filter((item): item is { question: string; answer: string } =>
      Boolean(item),
    );
  return items.length > 0 ? { count: items.length, items } : null;
}

function answersFromAskUserQuestionResult(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> | null {
  if (!metadata) return null;
  return (
    answersFromUnknown(metadata.result) ??
    answersFromUnknown(
      isRecordValue(metadata.result)
        ? (metadata.result.data as unknown)
        : undefined,
    ) ??
    answersFromUnknown(metadata.content)
  );
}

function answersFromUnknown(value: unknown): Record<string, string> | null {
  if (isRecordValue(value) && isStringRecord(value.answers)) {
    return value.answers;
  }
  if (isStringRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return answersFromUnknown(parsed);
  } catch {
    return null;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecordValue(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 && entries.every(([, item]) => typeof item === "string")
  );
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function commandRunView(run: TimelineToolRun): CommandRunView {
  const toolLabel = displayToolName(run.toolName);
  const displayCommand = run.callContent || run.resultContent || toolLabel;
  const statusKind: CommandRunStatusKind =
    run.isWaitingForPermission || run.isRunning
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
  const questionResult = parseAskUserQuestionTimelineResult(run);
  if (questionResult) {
    return (
      <li className="timeline-question-result">
        {questionResult.items.map((item) => (
          <div className="timeline-question-result-item" key={item.question}>
            <strong>{item.question}</strong>
            <span>{item.answer}</span>
          </div>
        ))}
      </li>
    );
  }

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

      <div aria-hidden={!isOpen} className="timeline-command-shell-wrap">
        <article
          className={`timeline-command-shell timeline-command-shell--${view.statusKind}`}
        >
          <div className="timeline-command-shell-header">{view.shellTitle}</div>
          <div className="timeline-command-shell-scroll-area">
            <div className="timeline-command-shell-scroll-x">
              <pre className="timeline-command-shell-body">
                <span className="timeline-command-shell-prompt">$</span>{" "}
                {view.displayCommand}
                {view.displayOutput ? `\n${view.displayOutput}` : ""}
              </pre>
            </div>
          </div>
          <footer className="timeline-command-shell-footer">
            <span className="timeline-command-shell-status">
              {view.statusKind === "success" ? (
                <Check
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : view.statusKind === "error" ? (
                <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
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
  const { onSubmitEditedUserMessage, sessionStatus } = useQuickChatContext();
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(message.text);
  const [isSubmittingEdit, setIsSubmittingEdit] = React.useState(false);
  const editTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  // Typewriter effect removed: completed messages display immediately.
  // Real streaming output is handled via MarkdownMessage `streaming` prop.
  const shouldTypewrite = false;
  const renderedText = useTypewriterText({
    enabled: shouldTypewrite,
    text: message.text,
  });
  const canSubmitEdit =
    Boolean(draft.trim()) &&
    !isSubmittingEdit &&
    sessionStatus !== "running" &&
    sessionStatus !== "waiting";

  React.useEffect(() => {
    if (!isEditing) return;
    setDraft(message.text);
    window.requestAnimationFrame(() => {
      editTextareaRef.current?.focus();
      editTextareaRef.current?.setSelectionRange(
        editTextareaRef.current.value.length,
        editTextareaRef.current.value.length,
      );
    });
  }, [isEditing, message.text]);

  async function submitEdit(): Promise<void> {
    if (!canSubmitEdit) return;
    setIsSubmittingEdit(true);
    try {
      await onSubmitEditedUserMessage(draft.trim());
      setIsEditing(false);
    } catch (error) {
      window.alert(
        `发送失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  if (message.role === "user") {
    const sentAt = formatUserMessageTime(message.createdAt);
    if (isEditing) {
      return (
        <article className="chat-message-row user">
          <div className="user-message-editor">
            <textarea
              ref={editTextareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setIsEditing(false);
                  setDraft(message.text);
                  return;
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submitEdit();
                }
              }}
            />
            <div className="user-message-editor-actions">
              <button
                className="user-message-editor-button secondary"
                onClick={() => {
                  setIsEditing(false);
                  setDraft(message.text);
                }}
                type="button"
              >
                取消
              </button>
              <button
                className="user-message-editor-button primary"
                disabled={!canSubmitEdit}
                onClick={() => void submitEdit()}
                type="button"
              >
                发送
              </button>
            </div>
          </div>
        </article>
      );
    }

    return (
      <article className="chat-message-row user">
        <div className="user-message-bubble">{message.text}</div>
        <div className="user-message-meta" aria-label="用户消息操作">
          {sentAt ? <time>{sentAt}</time> : null}
          <MessageActionButton label="复制" tip="复制" text={message.text}>
            <Copy size={APP_ICON_SIZE} />
          </MessageActionButton>
          <Tooltip content="修改">
            <button
              aria-label="修改"
              className="message-action"
              onClick={() => {
                setDraft(message.text);
                setIsEditing(true);
              }}
              type="button"
            >
              <Pencil size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
        </div>
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

function formatUserMessageTime(createdAt: string | number | undefined): string {
  if (createdAt === undefined) return "";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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
  left: {
    number: number | null;
    content: string;
    tone: "removed" | "context" | "empty";
  };
  right: {
    number: number | null;
    content: string;
    tone: "added" | "context" | "empty";
  };
  paired: boolean;
};

type ReviewFilter = "all" | "added" | "modified" | "removed";

function filterStatusForFile(file: {
  status: string;
  isUntracked: boolean;
}): ReviewFilter {
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
  diffMarkerStyle,
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
  diffMarkerStyle: DesktopDiffMarkerStyle;
  reviewView: DesktopReviewView;
  workspacePath: string | null;
  onClose: () => void;
  onRefreshDiff: () => void;
  onOpenWorkspacePath: () => void;
  onRunCodeReview: () => void;
}): React.ReactNode {
  const turnGroup = React.useMemo(() => deriveReviewTurns(events), [events]);
  const turns = turnGroup.turns;
  const [selectedTurnId, setSelectedTurnId] = React.useState<string | null>(
    null,
  );
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
    if (selectedTurnId && !turns.some((turn) => turn.id === selectedTurnId)) {
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
        : (files[0]?.path ?? null),
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
      if (
        files.length > 0 &&
        selectedPath &&
        !visibleFiles.some((f) => f.path === selectedPath)
      ) {
        setSelectedPath(visibleFiles[0]?.path ?? null);
      }
      return;
    }
    if (
      !selectedPath ||
      !visibleFiles.some((file) => file.path === selectedPath)
    ) {
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
                      <small>{truncateToWidth(turn.userMessageText, 60)}</small>
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
                <Columns2 size={APP_ICON_SIZE} />
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
            selectedTurn ? selectedTurn.userMessageText : "全部轮次（累积变更）"
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
          diffMarkerStyle={diffMarkerStyle}
          file={selectedFile}
          view={reviewView}
          workspacePath={workspacePath}
        />
      ) : null}

      <ScrollArea
        className="review-file-list-scroll-area"
        contentClassName="review-file-list-scroll-content"
        role="list"
      >
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
      </ScrollArea>
    </aside>
  );
}

function ReviewDiffPreview({
  diffMarkerStyle,
  file,
  view,
  workspacePath,
}: {
  diffMarkerStyle: DesktopDiffMarkerStyle;
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
          <ReviewDiffSplit
            diffMarkerStyle={diffMarkerStyle}
            lines={file.lines}
          />
        ) : (
          <ReviewDiffInline
            diffMarkerStyle={diffMarkerStyle}
            lines={file.lines}
          />
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

function ReviewDiffInline({
  diffMarkerStyle,
  lines,
}: {
  diffMarkerStyle: DesktopDiffMarkerStyle;
  lines: ReviewDiffLine[];
}): React.ReactNode {
  return (
    <ScrollArea
      className="review-diff-scroll"
      contentClassName="review-diff-scroll-content"
    >
      <div className="review-diff-lines-scroll-x">
        <div
          className={`review-diff-lines review-diff-inline marker-${diffMarkerStyle}`}
        >
          {lines.map((line) => {
            if (line.type === "meta") {
              return (
                <div className={`review-diff-row ${line.type}`} key={line.id}>
                  <span className="review-diff-line-content">
                    {line.content}
                  </span>
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
                    <span className="review-diff-line-content">
                      {line.content}
                    </span>
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
                <DiffMarker tone={line.type} />
                <code className="review-diff-line-content">
                  {formatInlineDiffContent(line, diffMarkerStyle)}
                </code>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}

function ReviewDiffSplit({
  diffMarkerStyle,
  lines,
}: {
  diffMarkerStyle: DesktopDiffMarkerStyle;
  lines: ReviewDiffLine[];
}): React.ReactNode {
  const rows = React.useMemo(() => splitDiffLines(lines), [lines]);
  return (
    <ScrollArea
      className="review-diff-scroll"
      contentClassName="review-diff-scroll-content"
    >
      <div className="review-diff-lines-scroll-x">
        <div
          className={`review-diff-lines review-diff-split marker-${diffMarkerStyle}`}
        >
          {rows.map((row) => {
            if (row.hunk) {
              return (
                <div className="review-diff-row hunk" key={row.id}>
                  <span className="review-diff-line-content">
                    {row.hunk.content}
                  </span>
                </div>
              );
            }
            if (row.meta) {
              return (
                <div className="review-diff-row meta" key={row.id}>
                  <span className="review-diff-line-content">
                    {row.meta.content}
                  </span>
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
                    <DiffMarker tone={row.left.tone} />
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
                    <DiffMarker tone={row.right.tone} />
                    <code className="review-diff-line-content">
                      {row.right.tone === "empty" ? " " : row.right.content}
                    </code>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}

function DiffMarker({
  tone,
}: {
  tone:
    | ReviewDiffLine["type"]
    | ReviewSplitRow["left"]["tone"]
    | ReviewSplitRow["right"]["tone"];
}): React.ReactNode {
  return (
    <span className={`review-diff-marker ${tone}`} aria-hidden="true">
      {tone === "added" ? "+" : tone === "removed" ? "-" : ""}
    </span>
  );
}

function formatInlineDiffContent(
  line: ReviewDiffLine,
  diffMarkerStyle: DesktopDiffMarkerStyle,
): string {
  if (diffMarkerStyle === "symbol") {
    return stripDiffPrefix(line.content) || " ";
  }
  return line.content || " ";
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
  diff: _diff,
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
  const diffSummary = summarizeDiff(_diff);
  const gitLabel = branchName?.trim() || "未检测到 Git 分支";
  const changedFileCount = gitStatus?.files.length ?? 0;
  const workspaceAvailable = Boolean(workspacePath);

  return (
    <aside className="environment-panel" aria-label="环境信息">
      <header className="environment-panel-header">
        <span>环境信息</span>
      </header>
      <div className="environment-action-list">
        <button
          className="environment-action-row"
          disabled={!workspaceAvailable}
          type="button"
          onClick={onRefreshDiff}
        >
          <FileDiff size={APP_ICON_SIZE} />
          <span>变更{changedFileCount ? ` (${changedFileCount})` : ""}</span>
          <span className="environment-diff-counts">
            <strong>+{formatPanelNumber(diffSummary.additions)}</strong>
            <em>-{formatPanelNumber(diffSummary.deletions)}</em>
          </span>
        </button>
        <button
          className="environment-action-row"
          disabled={!workspaceAvailable}
          type="button"
          onClick={onOpenWorkspacePath}
        >
          <Laptop size={APP_ICON_SIZE} />
          <span>本地</span>
        </button>
        <button
          className="environment-action-row"
          disabled={!workspaceAvailable}
          title={gitLabel}
          type="button"
          onClick={onCreateBranch}
        >
          <GitBranch size={APP_ICON_SIZE} />
          <span>{gitLabel}</span>
        </button>
        <button
          className="environment-action-row"
          disabled={!workspaceAvailable}
          type="button"
          onClick={onCommitOrPush}
        >
          <Upload size={APP_ICON_SIZE} />
          <span>提交或推送</span>
        </button>
        <button
          className="environment-action-row"
          disabled={!workspaceAvailable}
          type="button"
          onClick={onCreatePullRequest}
        >
          <GitPullRequest size={APP_ICON_SIZE} />
          <span>创建拉取请求</span>
        </button>
      </div>
      <div className="environment-source">
        <span>来源</span>
        <small>暂无来源</small>
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
      pendingToolEvents.length > 0 &&
      (event.type === "error" || event.type === "checkpoint")
    ) {
      pendingToolEvents.push(terminalToolResultEvent(event));
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

export function groupTimelineExecutionPhases(
  items: TimelineItem[],
  sessionStatus: DesktopSessionStatus,
): PhaseTimelineItem[] {
  const result: PhaseTimelineItem[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    if (item.type === "proposed_plan") {
      // Found a proposed_plan — look ahead to find the rest of this turn
      const planItem = item;

      // Find the turn end: next checkpoint, error, user message, or end of items
      let turnEnd = i + 1;
      while (turnEnd < items.length) {
        const next = items[turnEnd];
        if (
          next.type === "checkpoint" ||
          next.type === "error" ||
          (next.type === "message" && next.role === "user")
        ) {
          break;
        }
        turnEnd++;
      }

      // Emit the plan card
      result.push(planItem);
      i++;

      // Categorize items between plan and end of turn
      const turnItems = items.slice(i, turnEnd);

      // Find the last assistant message in the turn items
      let lastAssistantIndex = -1;
      for (let j = turnItems.length - 1; j >= 0; j--) {
        const ti = turnItems[j];
        if (ti && ti.type === "message" && ti.role === "assistant") {
          lastAssistantIndex = j;
          break;
        }
      }

      // Separate items into execution, file patches, and final message
      const executionItems: TimelineItem[] = [];
      const filePatches: TimelineItem[] = [];
      let finalMessage: TimelineItem | null = null;

      for (let j = 0; j < turnItems.length; j++) {
        const ti = turnItems[j];
        if (ti.type === "file_patch") {
          filePatches.push(ti);
        } else if (
          j === lastAssistantIndex &&
          ti.type === "message" &&
          ti.role === "assistant"
        ) {
          finalMessage = ti;
        } else if (ti.type === "checkpoint") {
          // Skip checkpoints inside execution phase (rendered hidden)
        } else {
          executionItems.push(ti);
        }
      }

      // Determine if the turn is complete
      const isActive =
        sessionStatus === "running" || sessionStatus === "waiting";
      const hasTurnEnd = turnEnd < items.length;
      const endedByCheckpointOrError =
        hasTurnEnd &&
        (items[turnEnd]?.type === "checkpoint" ||
          items[turnEnd]?.type === "error");
      const isComplete = endedByCheckpointOrError || (!isActive && !hasTurnEnd);

      // Emit execution phase group only if there are execution items
      if (executionItems.length > 0) {
        result.push({
          id: `execution-phase-${planItem.id}`,
          type: "execution_phase",
          items: executionItems,
          isComplete,
        });
      }

      // Emit file patches (result cards — stay visible)
      for (const fp of filePatches) {
        result.push(fp);
      }

      // Emit final summary message (with actions)
      if (finalMessage) {
        result.push(finalMessage);
      }

      // Skip past the turn items we've processed
      i = turnEnd;
    } else {
      result.push(item);
      i++;
    }
  }

  return result;
}

function terminalToolResultEvent(
  event: DesktopSessionEvent,
): DesktopSessionEvent {
  return {
    id: `${event.id}-terminal-tool-result`,
    sessionId: event.sessionId,
    type: "tool_result",
    content:
      event.type === "error" ? event.content || "操作已中止" : "操作已停止",
    createdAt: event.createdAt,
    metadata: {
      isError: true,
    },
  };
}

export function buildDebugAskUserQuestionRequest(
  idSuffix = "sample",
): DesktopPermissionRequest {
  return {
    requestId: `${DEBUG_ASK_USER_QUESTION_REQUEST_ID_PREFIX}-${idSuffix}`,
    toolName: "AskUserQuestion",
    description: "调试 AskUserQuestion 卡片",
    input: {
      questions: [
        {
          question: "Model Router 功能指的是哪一种？",
          header: "路由",
          options: [
            {
              label: "按场景自动分派模型",
              description: "根据任务类型、上下文和成本自动选择模型。",
            },
            {
              label: "新增 Model Router 设置页",
              description: "只添加一个用于配置路由策略的设置页面。",
            },
            {
              label: "新增路由器模型条目",
              description: "只在模型列表中新增一个可选模型条目。",
            },
          ],
        },
        {
          question: "哪些交互需要覆盖？",
          header: "覆盖范围",
          multiSelect: true,
          options: [
            {
              label: "默认选中不算已回答",
              description: "只有用户显式确认后才更新已回答计数。",
            },
            {
              label: "多选 Enter 进入下一题",
              description: "非最后一题只确认当前题并前进。",
            },
            {
              label: "最后一题提交全部",
              description: "最后一题的 Enter 或提交按钮会提交全部答案。",
            },
          ],
        },
        {
          question: "最后一题应该如何提交？",
          header: "提交",
          options: [
            {
              label: "最后题 Enter 提交全部",
              description: "对齐 codex-main 的 submit binding 行为。",
            },
            {
              label: "仍然只确认当前题",
              description: "最后一题也不提交全部，只标记当前题已回答。",
            },
          ],
        },
      ],
    },
  };
}

function isDebugAskUserQuestionRequest(
  request: DesktopPermissionRequest,
): boolean {
  return request.requestId.startsWith(
    DEBUG_ASK_USER_QUESTION_REQUEST_ID_PREFIX,
  );
}

function buildToolGroup(
  events: DesktopSessionEvent[],
): TimelineToolGroup | null {
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
        pendingRun.permissionRequest = permissionRequestFromEvent(event);
      }
      continue;
    }
    if (pendingRun) {
      pendingRun.resultContent = content;
      pendingRun.resultMetadata = event.metadata;
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
      resultMetadata: event.metadata,
      isError: event.metadata?.isError === true,
      isRunning: false,
      isWaitingForPermission: false,
    });
  }

  const visibleRuns = runs.filter(
    (run) =>
      run.callContent || run.resultContent || run.isError || run.isRunning,
  );

  if (visibleRuns.length === 0) return null;

  return {
    id: `tool-group-${events[0]?.id ?? "empty"}`,
    type: "tool_group",
    runs: visibleRuns,
  };
}

function permissionRequestFromEvent(
  event: DesktopSessionEvent,
): DesktopPermissionRequest | undefined {
  const request = event.metadata?.request;
  if (!isRecordValue(request)) return undefined;
  return request as DesktopPermissionRequest;
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
  return content.startsWith(prefix)
    ? content.slice(prefix.length).trim()
    : content;
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
