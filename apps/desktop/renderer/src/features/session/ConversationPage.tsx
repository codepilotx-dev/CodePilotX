import React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AppWindow,
  Archive,
  Bot,
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
  Laptop,
  LayoutList,
  LoaderCircle,
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
  Workflow,
  X,
} from "lucide-react";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
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
import {
  WorkflowPlanCard,
  planTitleFromSummary,
  type OpenPlanInDockRequest,
} from "./WorkflowPlanCard.js";
import { parseAskUserQuestions } from "./AskUserQuestionApproval.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { ComposerFrame } from "./ComposerSurface.js";
import {
  clearConversationSelectionHighlight,
  createConversationSelectionSnapshot,
  installConversationSelectionHighlight,
} from "./conversationSelectionHighlight.js";
import { useTypewriterText } from "./TypewriterText.js";
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import { buildPopoverSizingStyle } from "../../components/ui/popoverSizing.js";
import { Tooltip } from "../../components/ui/Tooltip.js";
import { ScrollArea } from "../../components/ui/ScrollArea.js";
import {
  loadConversationUiState,
  saveConversationUiState,
} from "../layout/conversationUiState.js";
import { SessionTimelineView } from "./SessionTimelineView.js";
import { ThreadScrollLayout } from "./ThreadScrollLayout.js";
import { ConversationTurnNavRail } from "./ConversationTurnNavRail.js";
import type { SubagentProjection } from "@codepilotx/shared/thread";
import {
  ThreadSummaryErrorBoundary,
  ThreadSummaryInline,
  ThreadSummaryPanel,
  ThreadSummaryPopover,
} from "./ThreadSummaryPanel.js";
import { useThreadSummaryController } from "./threadSummaryState.js";
import { deriveThreadSummaryViewModel } from "./threadSummaryViewModel.js";
import { useConversationController } from "./useConversationController.js";
import {
  TimelineSystemNotice,
  timelineItemSlot,
} from "./TimelineItemView.js";
import {
  deriveAssistantActionMessageIds,
  deriveConversationTurnNavItems,
  deriveTimelineSourceEvents,
  foldTimelineEvents,
  groupTimelineExecutionPhases,
  groupTimelineToolEvents,
  type ConversationTurnNavItem,
  type ExecutionPhaseGroup,
  type PhaseTimelineItem,
  type TimelineItem,
  type TimelineToolGroup,
  type TimelineToolRun,
} from "./timelineModel.js";

export {
  deriveAssistantActionMessageIds,
  deriveConversationTurnNavItems,
  deriveTimelineSourceEvents,
  foldTimelineEvents,
  groupTimelineExecutionPhases,
  groupTimelineToolEvents,
} from "./timelineModel.js";
export type {
  ConversationTurnNavItem,
  ExecutionPhaseGroup,
  PhaseTimelineItem,
  TimelineItem,
  TimelineToolGroup,
  TimelineToolRun,
} from "./timelineModel.js";

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
    branches,
    diff,
    gitStatus,
    onArchiveSession,
    onCreateBranch,
    onOpenAutomation,
    onOpenWorkspacePath,
    onRefreshDiff,
    onToggleSessionPinned,
    onBranchSelect,
    onCommitOrPush,
    onCreatePullRequest,
    onDecidePermission,
    onAcceptExitPlanMode,
    onOpenRightDock,
    onOpenPlanInRightDock,
    onAppendComposerText,
    onAppendSideChatText,
    onOpenSubagent,
    permissionMode,
    pendingPermissions,
    composer,
    rightDockPlanEventId,
    debugMode,
  } = useQuickChatContext();
  const {
    defaultOpenTargetId,
    setDefaultOpenTargetId,
    diffMarkerStyle,
    reviewView,
    model,
  } = useDesktopSettings();
  const [subagents, setSubagents] = React.useState<SubagentProjection[]>([]);

  React.useEffect(() => {
    if (!activeSessionId || !desktopClient.listSubagents) {
      setSubagents([]);
      return;
    }
    let cancelled = false;
    const refresh = () => desktopClient.listSubagents!(activeSessionId).then(value => {
      if (!cancelled) setSubagents(value);
    }).catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSessionId]);

  const conversationMessages = React.useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
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
  const {
    assistantActionMessageIds,
    debugAskUserQuestionRequest,
    debugPlanCardSummary,
    phaseItems,
    setDebugAskUserQuestionRequest,
    setDebugPlanCardSummary,
    showThinking,
    timelineEvents,
    timelineItems,
    turnNavItems,
    workflowDerivedState,
  } = useConversationController({
    activeSessionId,
    conversationMessages,
    debugMode,
    events,
    pendingPermissions,
    sessionStatus,
    workflowEvents,
  });
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false);
  const [conversationSelectedText, setConversationSelectedText] =
    React.useState("");
  const [openTargetMenuOpen, setOpenTargetMenuOpen] = React.useState(false);
  const [openTargets, setOpenTargets] = React.useState<DesktopOpenTarget[]>(
    FALLBACK_OPEN_TARGETS,
  );
  React.useEffect(() => {
    return () => {
      clearConversationSelectionHighlight();
    };
  }, []);
  const [isRefreshingDiff, setIsRefreshingDiff] = React.useState(false);
  const timelineListRef = React.useRef<
    import("virtua").VirtualizerHandle | null
  >(
    null,
  );
  const threadScrollRef = React.useRef<HTMLDivElement | null>(null);
  const threadFooterRef = React.useRef<HTMLElement | null>(null);
  const initialTimelineScrollTop = React.useMemo(
    () =>
      activeSessionId
        ? (loadConversationUiState(activeSessionId)?.mainScrollTop ?? 0)
        : 0,
    [activeSessionId],
  );
  const mainScrollTopRef = React.useRef(0);
  const scrollRestoredRef = React.useRef<string | null>(null);

  const handleTimelineScroll = React.useCallback((scrollTop: number) => {
    mainScrollTopRef.current = scrollTop;
  }, []);

  React.useEffect(() => {
    const sessionId = activeSessionId;

    return () => {
      if (!sessionId) return;
      const existing = loadConversationUiState(sessionId);
      if (existing) {
        existing.mainScrollTop = mainScrollTopRef.current;
        saveConversationUiState(sessionId, existing);
      }
    };
  }, [activeSessionId]);

  React.useEffect(() => {
    if (isConversationLoading || !activeSessionId) return;
    if (scrollRestoredRef.current === activeSessionId) return;
    const saved = loadConversationUiState(activeSessionId);
    scrollRestoredRef.current = activeSessionId;
    mainScrollTopRef.current = saved?.mainScrollTop ?? 0;
    if (saved?.mainScrollTop && timelineListRef.current) {
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
  const changedFileCount = workspacePath ? (gitStatus?.files.length ?? 0) : 0;
  const hasComposerPlan = timelineEvents.some(
    (event) => event.type === "proposed_plan",
  );
  const showComposerStatusSummary = shouldShowComposerStatusSummary({
    hasPlan: hasComposerPlan,
    changedFileCount,
  });
  const composerDiffSummary = React.useMemo(() => summarizeDiff(diff), [diff]);
  const sourceLinks = React.useMemo(
    () => extractSourceLinks(timelineEvents),
    [timelineEvents],
  );
  const threadSummaryModel = React.useMemo(
    () =>
      deriveThreadSummaryViewModel({
        additions: composerDiffSummary.additions,
        branchName,
        changedFileCount,
        deletions: composerDiffSummary.deletions,
        events: timelineEvents,
        sources: sourceLinks,
        subagents,
        workspacePath,
      }),
    [
      branchName,
      changedFileCount,
      composerDiffSummary,
      sourceLinks,
      subagents,
      timelineEvents,
      workspacePath,
    ],
  );
  const workflowMainRef = React.useRef<HTMLElement>(null);
  const threadSummary = useThreadSummaryController(workflowMainRef);
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
    showComposerStatusSummary,
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

  function openDebugPlanCard(): void {
    setDebugAskUserQuestionRequest(null);
    setDebugPlanCardSummary(buildDebugPlanCardSummary());
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
        <FolderOpen
          aria-hidden="true"
          className="chat-session-title__icon"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
        <span>
          {isConversationLoading ? "加载对话中" : renderedSessionTitle}
        </span>
        <PopoverMenu
          align="start"
          className="popover-session-actions"
          open={sessionMenuOpen}
          width={220}
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
            disabled={!hasActiveSession}
            icon={<Workflow size={APP_ICON_SIZE} />}
            selected={workflowTimelineVisible}
            withCheck
            onClick={() =>
              setWorkflowTimelineVisible((current) => !current)
            }
          >
            显示 workflow 事件
          </PopoverItem>
          {debugMode ? (
            <>
              <PopoverItem
                disabled={hasRealPendingPermission}
                icon={<MessageSquarePlus size={APP_ICON_SIZE} />}
                onClick={openDebugAskUserQuestionCard}
              >
                弹出 AskUserQuestion 调试卡片
              </PopoverItem>
              <PopoverItem
                disabled={hasRealPendingPermission}
                icon={<FileDiff size={APP_ICON_SIZE} />}
                onClick={openDebugPlanCard}
              >
                弹出 PlanCard 调试卡片
              </PopoverItem>
            </>
          ) : null}
          <div className="popover-divider" />
          <PopoverItem disabled icon={<AppWindow size={APP_ICON_SIZE} />}>
            在新窗口中打开
          </PopoverItem>
        </PopoverMenu>
      </div>
    ),
    [
      activeSessionId,
      debugMode,
      hasActiveSession,
      hasRealPendingPermission,
      isConversationLoading,
      isSessionPinned,
      renderedSessionTitle,
      sessionMenuOpen,
      workflowTimelineVisible,
      workspacePath,
    ],
  );

  const workspaceHeaderActions = React.useMemo(
    () => {
      const summaryPanel = (
        <ThreadSummaryErrorBoundary>
          <ThreadSummaryPanel
            branches={branches}
            model={threadSummaryModel}
            onBranchSelect={onBranchSelect}
            onCommitOrPush={onCommitOrPush}
            onCreateBranch={onCreateBranch}
            onCreatePullRequest={onCreatePullRequest}
            onOpenPlan={onOpenPlanInRightDock}
            onOpenReview={openReviewSidebar}
            onOpenSubagent={onOpenSubagent}
            onOpenWorkspacePath={onOpenWorkspacePath}
          />
        </ThreadSummaryErrorBoundary>
      );
      const summaryToggle = (
        <button
          aria-label={
            threadSummary.displayMode === "overlay"
              ? threadSummary.isPopoverOpen
                ? "关闭置顶摘要"
                : "打开置顶摘要"
              : threadSummary.isPinned
                ? "取消置顶摘要"
                : "置顶摘要"
          }
          aria-pressed={
            threadSummary.displayMode === "overlay"
              ? threadSummary.isPopoverOpen
              : threadSummary.isPinned
          }
          className="message-action"
          title="置顶摘要"
          type="button"
          onClick={
            threadSummary.displayMode === "overlay"
              ? undefined
              : threadSummary.toggle
          }
        >
          <LayoutList
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </button>
      );

      return (
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
            width={220}
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
        {threadSummary.displayMode === "overlay" ? (
          <ThreadSummaryPopover
            open={threadSummary.isPopoverOpen}
            panel={summaryPanel}
            onOpenChange={threadSummary.setPopoverOpen}
          >
            {summaryToggle}
          </ThreadSummaryPopover>
        ) : (
          <Tooltip content="置顶摘要">{summaryToggle}</Tooltip>
        )}
        </div>
      );
    },
    [
      branches,
      defaultOpenTargetId,
      onBranchSelect,
      onCommitOrPush,
      onCreateBranch,
      onCreatePullRequest,
      onOpenPlanInRightDock,
      onOpenSubagent,
      onOpenWorkspacePath,
      openTargetMenuOpen,
      openTargets,
      selectedOpenTarget,
      threadSummary,
      threadSummaryModel,
    ],
  );

  const composerFooter = composer ? (
    <div className="chat-composer workflow-page__composer tw:pointer-events-none tw:flex tw:w-full tw:justify-center">
      <ComposerFrame
        ref={composerTransition.ref}
        className="workflow-page__composer-inner"
        style={composerTransition.style}
      >
        {showComposerStatusSummary ? (
          <div className="composer-change-summary">
            {hasComposerPlan ? (
              <span className="composer-change-summary__plan">
                <LoaderCircle
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                计划
              </span>
            ) : null}
            {hasComposerPlan && changedFileCount > 0 ? (
              <span
                aria-hidden="true"
                className="composer-change-summary__separator"
              >
                ·
              </span>
            ) : null}
            {changedFileCount > 0 ? (
              <span className="composer-change-summary__changes">
                {changedFileCount} 个文件已更改
                <strong> +{formatPanelNumber(composerDiffSummary.additions)}</strong>
                <em> -{formatPanelNumber(composerDiffSummary.deletions)}</em>
              </span>
            ) : null}
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
      </ComposerFrame>
    </div>
  ) : null;

  return (
    <section
      ref={workflowPageRef}
      className={
        activePermissionRequest
          ? "conversation-page workflow-page approval-active tw:relative tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-col tw:bg-app-canvas tw:text-app-text"
          : "conversation-page workflow-page tw:relative tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-col tw:bg-app-canvas tw:text-app-text"
      }
    >
      <header
        aria-label="会话工具栏"
        className="chat-session-header"
        role="toolbar"
      >
        {workspaceHeaderTitle}
        {workspaceHeaderActions}
      </header>
      <div
        className="workflow-page__body"
      >
        <main
          ref={workflowMainRef}
          className="workflow-page__main"
          style={
            {
              "--thread-summary-content-shift": `${threadSummary.contentShift}px`,
            } as React.CSSProperties
          }
        >
          <div className="workflow-main-scroll-frame">
            <ConversationTurnNavRail
              items={turnNavItems}
              onNavigate={(rowIndex) => {
                timelineListRef.current?.scrollToIndex(rowIndex, {
                  align: "center",
                });
              }}
            />
            <ThreadScrollLayout
              className="workflow-main-scroll-area"
              footer={composerFooter}
              footerRef={threadFooterRef}
              scrollRef={threadScrollRef}
            >
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
                  <div className="session-timeline-main tw:min-w-0">
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
                          {subagents.length ? (
                            <div className="subagent-timeline-summary" aria-label="子智能体任务">
                              {subagents.map(({ task, currentRun }) => (
                                <button key={task.id} type="button" onClick={() => onOpenSubagent(task.id)}>
                                  <Bot size={14} />
                                  <span>{task.displayName}</span>
                                  <small>{subagentPanelStatus(currentRun?.status ?? "interrupted")}</small>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <SessionTimelineView
                            count={phaseItems.length + (showThinking ? 1 : 0)}
                            initialScrollOffset={initialTimelineScrollTop}
                            sessionKey={activeSessionId ?? undefined}
                            scrollToBottom={
                              sessionStatus === "running" ||
                              sessionStatus === "waiting"
                            }
                            onScroll={handleTimelineScroll}
                            listRef={timelineListRef}
                            scrollRef={threadScrollRef}
                          >
                            {phaseItems.map((item) => (
                              <div
                                className="session-turn-row tw:mx-auto tw:w-full tw:max-w-[48rem] tw:min-w-0"
                                data-component="session-turn"
                                data-slot={timelineItemSlot(item)}
                                key={item.id}
                              >
                                <TimelineItem
                                  item={item}
                                  rightDockPlanEventId={rightDockPlanEventId}
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
                          </SessionTimelineView>
                        </>
                      )}
                  </div>
                </div>
              </ContextMenu.Trigger>
              {showConversationContextMenu ? (
                <ContextMenu.Portal>
                  <ContextMenu.Content
                    className="sidebar-context-menu-content"
                    style={buildPopoverSizingStyle({ width: 240 })}
                  >
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
            </ThreadScrollLayout>
          </div>
          {threadSummary.shouldShowInline ? (
            <ThreadSummaryInline>
              <ThreadSummaryErrorBoundary>
                <ThreadSummaryPanel
                  branches={branches}
                  model={threadSummaryModel}
                  onBranchSelect={onBranchSelect}
                  onCommitOrPush={onCommitOrPush}
                  onCreateBranch={onCreateBranch}
                  onCreatePullRequest={onCreatePullRequest}
                  onOpenPlan={onOpenPlanInRightDock}
                  onOpenReview={openReviewSidebar}
                  onOpenSubagent={onOpenSubagent}
                  onOpenWorkspacePath={onOpenWorkspacePath}
                />
              </ThreadSummaryErrorBoundary>
            </ThreadSummaryInline>
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
        <span className="popover-item-leading">
          <span className="popover-item-icon">{icon}</span>
        </span>
        <span className="popover-item-label">{label}</span>
        <span className="popover-item-trailing">
          <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZE} />
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          alignOffset={-6}
          className="popover-surface popover popover-sub-content"
          sideOffset={8}
          style={buildPopoverSizingStyle({ width: "auto" })}
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

export { planCardPresentation, planTitleFromSummary } from "./WorkflowPlanCard.js";

function workflowComposerMode(
  request: DesktopPermissionRequest | null,
): WorkflowComposerMode {
  if (!request) return "chat";
  if (request.toolName === "AskUserQuestion") return "brainstorm";
  if (request.toolName === "ExitPlanMode") return "plan";
  return "permission";
}

export function shouldShowComposerStatusSummary({
  hasPlan,
  changedFileCount,
}: {
  hasPlan: boolean;
  changedFileCount: number;
}): boolean {
  return hasPlan || changedFileCount > 0;
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
  rightDockPlanEventId,
  showActions,
  onOpenPlanInRightDock,
  onReviewFiles,
  onReviewCode,
  onDiscardChanges,
}: {
  item: PhaseTimelineItem;
  rightDockPlanEventId: string | null;
  showActions: boolean;
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
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
    if (event.type === "message" && event.role === "system") {
      return <TimelineSystemNotice content={event.content ?? ""} />;
    }
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
    return (
      <article className="chat-message-row assistant tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-start tw:text-base tw:text-app-text">
        <div className="assistant-message-body tw:w-full tw:text-base tw:leading-[22px] tw:text-app-text">
          <WorkflowPlanCard
            eventId={event.id}
            summary={summary}
            streaming={event.metadata?.streaming === true}
            isDocked={rightDockPlanEventId === event.id}
            onOpenInRightDock={onOpenPlanInRightDock}
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
    return <TimelineSystemNotice content={event.content ?? ""} type={event.type} />;
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
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
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
              rightDockPlanEventId={null}
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
      const answer = resolveQuestionAnswer(answers, question);
      return typeof answer === "string" && answer.trim()
        ? { question: question.question, answer: answer.trim() }
        : null;
    })
    .filter((item): item is { question: string; answer: string } =>
      Boolean(item),
    );
  return items.length > 0 ? { count: items.length, items } : null;
}

function resolveQuestionAnswer(
  answers: Record<string, string>,
  question: { id?: string; question: string },
): string | undefined {
  if (question.id && answers[question.id]) return answers[question.id];
  return answers[question.question];
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
  // New sidecar format: answers values are { answers: string[] }
  if (isRecordValue(value) && isRecordValue(value.answers)) {
    const flattened = flattenToolRequestAnswerValues(value.answers as Record<string, unknown>);
    if (flattened) return flattened;
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

function flattenToolRequestAnswerValues(
  raw: Record<string, unknown>,
): Record<string, string> | null {
  const result: Record<string, string> = {};
  const entries = Object.entries(raw);
  if (entries.length === 0) return null;
  for (const [key, value] of entries) {
    if (isRecordValue(value) && Array.isArray(value.answers) && value.answers.length > 0) {
      result[key] = String(value.answers[0]);
    } else if (typeof value === "string") {
      result[key] = value;
    } else {
      return null;
    }
  }
  return result;
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
  // While running, prefer live outputContent over the final resultContent
  const displayOutput = run.isRunning && run.outputContent
    ? run.outputContent
    : run.resultContent;
  return {
    commandLabel: displayCommand,
    displayCommand,
    displayOutput,
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
          className={`timeline-command-shell timeline-command-shell--${view.statusKind} tw:my-1 tw:overflow-hidden tw:rounded-lg tw:bg-app-panel`}
        >
          <div className="timeline-command-shell-header">{view.shellTitle}</div>
          <div className="timeline-command-shell-scroll-area">
            <div className="timeline-command-shell-scroll-x">
          <pre className="timeline-command-shell-body tw:m-0 tw:min-w-max tw:px-3 tw:py-2 tw:font-mono tw:text-sm tw:leading-5 tw:text-app-text">
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
  const {
    messages,
    onSubmitEditedUserMessage,
    onOpenFileReference,
    sessionStatus,
    workspacePath,
  } = useQuickChatContext();
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(message.text);
  const [isSubmittingEdit, setIsSubmittingEdit] = React.useState(false);
  const [isUserMessageExpanded, setIsUserMessageExpanded] =
    React.useState(false);
  const [canExpandUserMessage, setCanExpandUserMessage] =
    React.useState(false);
  const editTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const userMessageContentRef = React.useRef<HTMLDivElement | null>(null);
  const userMessageContentId = React.useId();
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
  const messageIndex = messages.findIndex((item) => item.id === message.id);
  const retryInput = messageIndex > 0
    ? messages
        .slice(0, messageIndex)
        .reverse()
        .find((item) => item.role === "user")?.text.trim() ?? ""
    : "";
  const canRetry =
    Boolean(retryInput) &&
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

  React.useLayoutEffect(() => {
    if (message.role !== "user") return;
    const element = userMessageContentRef.current;
    if (!element) return;

    if (isUserMessageExpanded) {
      setCanExpandUserMessage(true);
      return;
    }

    const updateOverflowState = (): void => {
      setCanExpandUserMessage(element.scrollHeight > element.clientHeight + 1);
    };
    updateOverflowState();

    const observer = new ResizeObserver(updateOverflowState);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isUserMessageExpanded, message.role, message.text]);

  React.useEffect(() => {
    setIsUserMessageExpanded(false);
  }, [message.text]);

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
        <article className="chat-message-row user tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-end tw:text-base tw:text-app-text">
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
      <article className="chat-message-row user tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-end tw:text-base tw:text-app-text">
        <div
          className={`user-message-bubble${isUserMessageExpanded ? " is-expanded" : ""} tw:rounded-2xl tw:px-3 tw:py-2 tw:text-base tw:leading-6 tw:text-app-text`}
        >
          <div
            className="user-message-content"
            id={userMessageContentId}
            ref={userMessageContentRef}
          >
            {message.text}
          </div>
          {canExpandUserMessage ? (
            <button
              aria-controls={userMessageContentId}
              aria-expanded={isUserMessageExpanded}
              className="user-message-expand-toggle"
              onClick={() => setIsUserMessageExpanded((expanded) => !expanded)}
              type="button"
            >
              <span>
                {isUserMessageExpanded ? "收起" : "显示更多"}
              </span>
              <ChevronDown aria-hidden="true" />
            </button>
          ) : null}
        </div>
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
    <article
      className={`chat-message-row ${message.role} tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-start tw:text-base tw:text-app-text`}
    >
      <div className="assistant-message-body tw:w-full tw:text-base tw:leading-[22px] tw:text-app-text">
        <MarkdownMessage
          cwd={workspacePath}
          onOpenFileReference={onOpenFileReference}
          text={renderedText}
          streaming={Boolean(message.streaming)}
        />
      </div>
      {showActions && message.role === "assistant" && message.text.trim() ? (
        <div className="user-message-meta assistant-message-actions">
          <MessageActionButton label="复制" tip="复制" text={message.text}>
            <Copy size={APP_ICON_SIZE} />
          </MessageActionButton>
          {canRetry ? <Tooltip content="重新生成">
            <button
              aria-label="重新生成"
              className="message-action"
              onClick={() => void onSubmitEditedUserMessage(retryInput)}
              type="button"
            >
              <RotateCcw size={APP_ICON_SIZE} />
            </button>
          </Tooltip> : null}
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
            width={220}
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
            width={220}
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
          className="review-diff-lines review-diff-inline"
          data-marker-style={diffMarkerStyle}
        >
          {lines.map((line) => {
            if (line.type === "meta") {
              return (
                <div
                  className="review-diff-row u-grid u-items-stretch"
                  data-line-type={line.type}
                  key={line.id}
                >
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
                  <div
                    className="review-diff-row u-grid u-items-stretch"
                    data-line-type={line.type}
                  >
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
              <div
                className="review-diff-row u-grid u-items-stretch"
                data-line-type={line.type}
                key={line.id}
              >
                <span
                  className="review-diff-line-number u-text-right"
                  data-tone={line.type}
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
          className="review-diff-lines review-diff-split"
          data-marker-style={diffMarkerStyle}
        >
          {rows.map((row) => {
            if (row.hunk) {
              return (
                <div
                  className="review-diff-row u-grid u-items-stretch"
                  data-line-type="hunk"
                  key={row.id}
                >
                  <span className="review-diff-line-content">
                    {row.hunk.content}
                  </span>
                </div>
              );
            }
            if (row.meta) {
              return (
                <div
                  className="review-diff-row u-grid u-items-stretch"
                  data-line-type="meta"
                  key={row.id}
                >
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
                  className="review-diff-split-row u-grid u-min-w-0"
                  data-layout={row.paired ? "paired" : "single"}
                >
                  <div
                    className="review-diff-side u-grid u-min-w-0"
                    data-tone={row.left.tone}
                  >
                    <span
                      className="review-diff-line-number u-text-right"
                      data-tone={row.left.tone}
                    >
                      {row.left.number ?? ""}
                    </span>
                    <DiffMarker tone={row.left.tone} />
                    <code className="review-diff-line-content">
                      {row.left.tone === "empty" ? " " : row.left.content}
                    </code>
                  </div>
                  <div
                    className="review-diff-side u-grid u-min-w-0"
                    data-tone={row.right.tone}
                  >
                    <span
                      className="review-diff-line-number u-text-right"
                      data-tone={row.right.tone}
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
    <span className="review-diff-marker" data-tone={tone} aria-hidden="true">
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

type SourceLink = {
  label: string;
  url: string;
};

function extractSourceLinks(events: DesktopSessionEvent[]): SourceLink[] {
  const byUrl = new Map<string, SourceLink>();
  for (const event of events) {
    if (
      event.type !== "message" &&
      event.type !== "proposed_plan" &&
      event.type !== "tool_result"
    ) {
      continue;
    }
    if (event.type === "message" && event.role !== "assistant") {
      continue;
    }
    for (const source of extractLinksFromText(event.content ?? "")) {
      addSourceLink(byUrl, source);
    }
    for (const source of extractLinksFromUnknown(event.metadata)) {
      addSourceLink(byUrl, source);
    }
  }
  return [...byUrl.values()];
}

function addSourceLink(
  byUrl: Map<string, SourceLink>,
  source: SourceLink,
): void {
  if (isLocalURL(source.url) || byUrl.has(source.url)) return;
  byUrl.set(source.url, {
    label: truncateToWidth(source.label || source.url, 42),
    url: source.url,
  });
}

function extractLinksFromText(text: string): SourceLink[] {
  const links: SourceLink[] = [];
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of text.matchAll(markdownLinkPattern)) {
    const label = match[1]?.trim();
    const url = normalizeSourceURL(match[2] ?? "");
    if (url) links.push({ label: label || sourceLabelFromURL(url), url });
  }
  const bareUrlPattern = /https?:\/\/[^\s<>)\]]+/g;
  for (const match of text.matchAll(bareUrlPattern)) {
    const url = normalizeSourceURL(match[0] ?? "");
    if (url) links.push({ label: sourceLabelFromURL(url), url });
  }
  return links;
}

function extractLinksFromUnknown(value: unknown): SourceLink[] {
  if (!value) return [];
  if (typeof value === "string") {
    return extractLinksFromText(value);
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractLinksFromUnknown);
  }
  if (typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const directUrl =
    typeof record.url === "string"
      ? record.url
      : typeof record.uri === "string"
        ? record.uri
        : typeof record.href === "string"
          ? record.href
          : null;
  const directTitle =
    typeof record.title === "string"
      ? record.title
      : typeof record.name === "string"
        ? record.name
        : typeof record.label === "string"
          ? record.label
          : null;
  const direct = normalizeSourceURL(directUrl ?? "");
  const nested = Object.values(record).flatMap(extractLinksFromUnknown);
  return direct
    ? [{ label: directTitle ?? sourceLabelFromURL(direct), url: direct }, ...nested]
    : nested;
}

function normalizeSourceURL(value: string): string | null {
  const normalized = value.trim().replace(/[.,;:!?]+$/, "");
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    return null;
  }
  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function sourceLabelFromURL(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return path ? `${parsed.hostname}${path}` : parsed.hostname;
  } catch {
    return url;
  }
}

function isLocalURL(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function subagentPanelStatus(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "stopped") return "已停止";
  if (status === "interrupted") return "已中断";
  if (status === "queued") return "排队中";
  if (status === "waiting-question") return "等待回答";
  if (status === "waiting-permission") return "等待审批";
  if (status === "steering") return "调整中";
  return "运行中";
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

export function buildDebugPlanCardSummary(): string {
  return (
    "# Model Router 实现计划\n\n" +
    "## Summary\n" +
    "新增 Model Router 功能，根据任务类型、上下文和成本自动将请求分派到最优模型。\n\n" +
    "## 步骤\n\n" +
    "### 1. 新增路由配置类型\n" +
    "- 在 `types/index.ts` 中新增 `ModelRouterConfig` 接口\n" +
    "- 包含 `defaultModel`、`codeModel`、`creativeModel` 等字段\n\n" +
    "### 2. 新增路由选择逻辑\n" +
    "- 在 `services/router.ts` 中实现 `selectModel` 函数\n" +
    "- 根据任务类型（code/reasoning/creative/simple）自动匹配\n" +
    "- 处理模型不可用时的降级策略\n\n" +
    "### 3. 集成到现有发送流程\n" +
    "- 在 `useQuickChatContext.ts` 的 `sendMessage` 中调用路由\n" +
    "- 替换硬编码模型选择\n" +
    "- 保留用户手动覆盖模型的优先级\n\n" +
    "### 4. 添加设置页面\n" +
    "- 在 Settings 页面新增 Router 配置区域\n" +
    "- 允许用户为每种任务类型指定模型\n" +
    "- 显示当前路由映射概览\n"
  );
}

function isDebugAskUserQuestionRequest(
  request: DesktopPermissionRequest,
): boolean {
  return request.requestId.startsWith(
    DEBUG_ASK_USER_QUESTION_REQUEST_ID_PREFIX,
  );
}

function numberMetadata(
  event: DesktopSessionEvent,
  key: string,
): number | null {
  const value = event.metadata?.[key];
  return typeof value === "number" ? value : null;
}

function displayToolName(toolName: string): string {
  return toolName === "Bash" ? "Shell" : toolName;
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
