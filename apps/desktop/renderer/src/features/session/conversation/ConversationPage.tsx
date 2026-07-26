import React from "react";
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
} from "../../../components/ui/iconTokens.js";
import { deriveWorkflowSessionState } from "../../../../shared/workflowReducer.js";
import type {
  DesktopDiffMarkerStyle,
  DesktopGitStatus,
  DesktopOpenTarget,
  DesktopPermissionRequest,
  DesktopReviewView,
  DesktopSessionEvent,
  DesktopSessionStatus,
  DesktopWorkflowEvent,
} from "../../../../shared/types.js";
import { useQuickChatContext } from "../QuickChatContext.js";
import { useDesktopSettings } from "../../settings/useDesktopSettings.js";
import { WorkspaceHeaderItem } from "../../layout/workspace-header/index.js";
import {
  buildWorkflowMarkdownReport,
  type WorkflowMarkdownLogDiagnostics,
} from "../workflow/workflowMarkdown.js";
import { buildWorkspaceCodexContextDiagnostics } from "../codexContextDiagnostics.js";
import { useHeightTransition } from "../../../hooks/useHeightTransition.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";
import {
  deriveWorkflowConsistencyDiagnostics,
  workflowConsistencyIssueCount,
  type WorkflowConsistencyDiagnostics,
} from "../workflow/workflowConsistency.js";
import { desktopClient } from "../../../services/desktop-client/index.js";
import { deriveReviewTurns } from "../reviewTurns.js";
import type { Message } from "../../../uiTypes.js";
import { InlineApprovalCard } from "../approvals/InlineApprovalCard.js";
import {
  WorkflowPlanCard,
  planTitleFromSummary,
  type OpenPlanInDockRequest,
} from "../workflow/WorkflowPlanCard.js";
import { parseAskUserQuestions } from "../approvals/askUserQuestionModel.js";
import { MarkdownMessage } from "../MarkdownMessage.js";
import { CollapsibleUserMarkdown } from "./CollapsibleUserMarkdown.js";
import { ComposerFrame } from "../composer/ComposerSurface.js";
import { DesktopComposer } from "../composer/DesktopComposer.js";
import {
  clearConversationSelectionHighlight,
  createConversationSelectionSnapshot,
  installConversationSelectionHighlight,
} from "./conversationSelectionHighlight.js";
import { useTypewriterText } from "./TypewriterText.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { AppContextMenu } from "../../../components/ui/AppContextMenu.js";
import { buildPopoverSizingStyle } from "../../../components/ui/popoverSizing.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { ScrollArea } from "../../../components/ui/ScrollArea.js";
import {
  loadConversationUiState,
  saveConversationUiState,
} from "../../layout/tabs/conversationUiState.js";
import { CanonicalThreadView } from "../timeline/CanonicalThreadView.js";
import type { ThreadTimelineNavigationHandle } from "../timeline/SessionTimelineView.js";
import { ThreadScrollLayout } from "./ThreadScrollLayout.js";
import {
  ConversationTurnNavRail,
  type TurnNavigationReason,
} from "./ConversationTurnNavRail.js";
import type { SubagentProjection } from "@codepilotx/shared/thread";
import {
  ThreadSummaryErrorBoundary,
  ThreadSummaryInline,
  ThreadSummaryPanel,
  ThreadSummaryPopover,
} from "../summary/ThreadSummaryPanel.js";
import { useThreadSummaryController } from "../summary/threadSummaryState.js";
import { deriveThreadSummaryViewModel } from "../summary/threadSummaryViewModel.js";
import { useConversationController } from "./useConversationController.js";
import {
  deriveConversationTurnNavItems,
  type ConversationTurnNavItem,
} from "./turnNavigationModel.js";
import { useCanonicalThreadConversation } from "../timeline/useCanonicalThreadConversation.js";
import { TimelineSystemNotice } from "../timeline/TimelineItemView.js";
import {
  deriveAssistantActionMessageIds,
  deriveTimelineSourceEvents,
  foldTimelineEvents,
  groupTimelineExecutionPhases,
  groupTimelineToolEvents,
  type ExecutionPhaseGroup,
  type PhaseTimelineItem,
  type TimelineItem,
  type TimelineToolGroup,
  type TimelineToolRun,
} from "../timeline/timelineModel.js";

export {
  deriveAssistantActionMessageIds,
  deriveTimelineSourceEvents,
  foldTimelineEvents,
  groupTimelineExecutionPhases,
  groupTimelineToolEvents,
} from "../timeline/timelineModel.js";
export { deriveConversationTurnNavItems } from "./turnNavigationModel.js";
export type {
  ExecutionPhaseGroup,
  PhaseTimelineItem,
  TimelineItem,
  TimelineToolGroup,
  TimelineToolRun,
} from "../timeline/timelineModel.js";
export type { ConversationTurnNavItem } from "./turnNavigationModel.js";

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

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

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
    onOpenRightDock,
    onOpenPlanInRightDock,
    onAppendComposerText,
    onAppendSideChatText,
    onOpenSubagent,
    permissionMode,
    pendingPermissions,
    composerProps,
    rightDockPlanEventId,
    debugMode,
  } = useQuickChatContext();
  const {
    defaultOpenTargetId,
    setDefaultOpenTargetId,
    diffMarkerStyle,
    reviewView,
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
    debugAskUserQuestionRequest,
    debugPlanCardSummary,
    setDebugAskUserQuestionRequest,
    setDebugPlanCardSummary,
    timelineEvents,
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
  const canonicalConversation = useCanonicalThreadConversation(activeSessionId);
  const reduceMotion = usePrefersReducedMotion();
  const turnNavItems = React.useMemo<ConversationTurnNavItem[]>(
    () => deriveConversationTurnNavItems(canonicalConversation.turns),
    [canonicalConversation.turns],
  );
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
  const timelineNavigationRef =
    React.useRef<ThreadTimelineNavigationHandle | null>(null);
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

  const handleTurnNavigate = React.useCallback(
    (item: ConversationTurnNavItem, reason: TurnNavigationReason): void => {
      const didNavigate = timelineNavigationRef.current?.revealTurn(
        item.rowIndex,
        reason === "scrub" || reduceMotion ? "instant" : "smooth",
      );
      if (!didNavigate) return;
      if (reduceMotion) return;

      let remainingAttempts = 6;
      const flashTurn = (): void => {
        const root = threadScrollRef.current;
        const selector = `[data-turn-navigation-id="${escapeCssAttributeValue(
          item.id,
        )}"]`;
        const row = root?.querySelector<HTMLElement>(selector);
        if (!row) {
          remainingAttempts -= 1;
          if (remainingAttempts > 0) window.requestAnimationFrame(flashTurn);
          return;
        }
        const highlightTarget =
          row.querySelector<HTMLElement>("[data-user-message-bubble]") ?? row;
        highlightTarget.animate?.(
          [
            {
              backgroundColor:
                "color-mix(in srgb, var(--color-token-foreground) 14%, transparent)",
            },
            {
              backgroundColor:
                "color-mix(in srgb, var(--color-token-foreground) 14%, transparent)",
              offset: 0.35,
            },
            {
              backgroundColor:
                "color-mix(in srgb, var(--color-token-foreground) 5%, transparent)",
            },
          ],
          {
            duration: 1400,
            easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          },
        );
      };
      window.requestAnimationFrame(flashTurn);
    },
    [reduceMotion],
  );

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
    composerProps ? "mounted" : "unmounted",
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
  }, [composerProps, composerTransition.ref, workflowPageRef]);

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
    url.pathname = `/threads/${encodeURIComponent(activeSessionId)}`;
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

  const openReviewSidebar = React.useCallback((): void => {
    onRefreshDiff();
    onOpenRightDock("review");
  }, [onOpenRightDock, onRefreshDiff]);

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

  const composerFooter = composerProps ? (
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
          />
        ) : (
          <DesktopComposer {...composerProps} />
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
      <WorkspaceHeaderItem
        align="start"
        id="conversation.title"
        order={0}
        slot="left"
      >
        {workspaceHeaderTitle}
      </WorkspaceHeaderItem>
      <WorkspaceHeaderItem
        align="end"
        id="conversation.actions"
        order={100}
        slot="right"
      >
        {workspaceHeaderActions}
      </WorkspaceHeaderItem>
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
              onNavigate={handleTurnNavigate}
              scrollRef={threadScrollRef}
            />
            <ThreadScrollLayout
              className="workflow-main-scroll-area"
              footer={composerFooter}
              footerRef={threadFooterRef}
              scrollRef={threadScrollRef}
            >
            <AppContextMenu
              actions={
                showConversationContextMenu
                  ? [
                      {
                        kind: "item",
                        label: "添加到对话",
                        onSelect: handleAddToConversation,
                      },
                      {
                        kind: "item",
                        label: "在侧边聊天中提问",
                        onSelect: handleAskInSideChat,
                      },
                    ]
                  : []
              }
              onOpenChange={(open) => {
                if (!open) {
                  clearConversationSelectionHighlight();
                }
              }}
              trigger={
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
                          {activeSessionId ? (
                            <CanonicalThreadView
                              active={
                                sessionStatus === "running" ||
                                sessionStatus === "waiting"
                              }
                              error={canonicalConversation.error}
                              hasOlder={canonicalConversation.hasOlder}
                              initialScrollOffset={initialTimelineScrollTop}
                              listRef={timelineListRef}
                              navigationRef={timelineNavigationRef}
                              loading={canonicalConversation.loading}
                              loadingOlder={canonicalConversation.loadingOlder}
                              onLoadOlder={canonicalConversation.loadOlder}
                              onOpenPlanInRightDock={onOpenPlanInRightDock}
                              onOpenSubagent={onOpenSubagent}
                              onReload={canonicalConversation.reload}
                              onScroll={handleTimelineScroll}
                              rightDockPlanEventId={rightDockPlanEventId}
                              scrollRef={threadScrollRef}
                              threadId={activeSessionId}
                              turns={canonicalConversation.turns}
                            />
                          ) : null}
                        </>
                      )}
                  </div>
                </div>
              }
              width={240}
            />
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

export { planCardPresentation, planTitleFromSummary } from "../workflow/WorkflowPlanCard.js";

function workflowComposerMode(
  request: DesktopPermissionRequest | null,
): WorkflowComposerMode {
  if (!request) return "chat";
  if (request.toolName === "AskUserQuestion") return "brainstorm";
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
  return "permission";
}

function workflowTitleForPermission(request: DesktopPermissionRequest): string {
  if (request.toolName === "AskUserQuestion") return "等待用户回答问题";
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

const TimelineItem = React.memo(function TimelineItem({
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
}, (previous, next) => {
  const previousItem = previous.item;
  const nextItem = next.item;
  if (
    previousItem.type !== "message" ||
    nextItem.type !== "message" ||
    previousItem.role !== "assistant" ||
    nextItem.role !== "assistant"
  ) {
    return false;
  }
  return (
    previousItem.id === nextItem.id &&
    previousItem.content === nextItem.content &&
    previous.showActions === next.showActions &&
    previous.rightDockPlanEventId === next.rightDockPlanEventId &&
    previous.onOpenPlanInRightDock === next.onOpenPlanInRightDock &&
    previous.onDiscardChanges === next.onDiscardChanges &&
    previous.onReviewCode === next.onReviewCode &&
    previous.onReviewFiles === next.onReviewFiles
  );
});

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
          className={`timeline-command-shell timeline-command-shell--${view.statusKind} tw:my-1 tw:overflow-hidden tw:rounded-lg`}
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
    canCopyFileReferenceContents,
    messages,
    onCopyFileReferenceContents,
    onSubmitEditedUserMessage,
    onOpenFileReference,
    sessionStatus,
    workspacePath,
  } = useQuickChatContext();
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
          className="user-message-bubble tw:rounded-2xl tw:px-3 tw:py-2 tw:text-base tw:leading-6 tw:text-app-text"
          data-user-message-bubble
        >
          <CollapsibleUserMarkdown
            canCopyFileReferenceContents={canCopyFileReferenceContents}
            cwd={workspacePath}
            onCopyFileReferenceContents={onCopyFileReferenceContents}
            onOpenFileReference={onOpenFileReference}
            text={message.text}
          />
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
          canCopyFileReferenceContents={canCopyFileReferenceContents}
          cwd={workspacePath}
          onCopyFileReferenceContents={onCopyFileReferenceContents}
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
