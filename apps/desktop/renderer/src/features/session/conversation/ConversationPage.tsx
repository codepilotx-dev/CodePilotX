import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AppWindow,
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  File,
  FolderOpen,
  GitBranch,
  Laptop,
  LayoutList,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  Sparkles,
  SquareTerminal,
  Workflow,
} from "lucide-react";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import type {
  DesktopOpenTarget,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionStatus,
} from "../../../../shared/types.js";
import { useQuickChatContext } from "../QuickChatContext.js";
import { useDesktopSettings } from "../../settings/useDesktopSettings.js";
import { WorkspaceHeaderItem } from "../../layout/workspace-header/index.js";
import { useHeightTransition } from "../../../hooks/useHeightTransition.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";
import { desktopClient } from "../../../services/desktop-client/index.js";
import { InlineApprovalCard } from "../approvals/InlineApprovalCard.js";
import { ComposerFrame } from "../composer/ComposerSurface.js";
import {
  ComposerChangeSummary,
  findLatestExecutionPlan,
} from "../composer/ComposerChangeSummary.js";
import { DesktopComposer } from "../composer/DesktopComposer.js";
import {
  clearConversationSelectionHighlight,
  createConversationSelectionSnapshot,
  installConversationSelectionHighlight,
} from "./conversationSelectionHighlight.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { AppContextMenu } from "../../../components/ui/AppContextMenu.js";
import { buildPopoverSizingStyle } from "../../../components/ui/popoverSizing.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { ConfirmationDialog } from "../../../components/ui/ConfirmationDialog.js";
import { SkeletonBlock } from "../../../components/ui/Skeleton.js";
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
import {
  deriveConversationTurnNavItems,
  type ConversationTurnNavItem,
} from "./turnNavigationModel.js";
import { useCanonicalThreadConversation } from "../timeline/useCanonicalThreadConversation.js";
import { selectCanonicalConversationAuxiliaryState } from "./canonicalConversationSelectors.js";
import {
  canRegenerateConversationTitle,
  shouldCloseConversationRenameDialog,
} from "./conversationTitleActions.js";
export { deriveConversationTurnNavItems } from "./turnNavigationModel.js";
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

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

export function ConversationPage(): React.ReactNode {
  const {
    isConversationLoading,
    activeSessionId,
    activeSessionPinnedAt,
    sessionTitle,
    editableSessionTitle,
    titleRegenerating,
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
    onRenameSession,
    onRefreshSessionTitle,
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
    composerProps,
    rightDockPlanEventId,
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

  const canonicalConversation = useCanonicalThreadConversation(activeSessionId);
  const canonicalAuxiliary = React.useMemo(
    () =>
      selectCanonicalConversationAuxiliaryState(canonicalConversation.state),
    [canonicalConversation.state],
  );
  const pendingPermissions = canonicalAuxiliary.pendingPermissions;
  const reduceMotion = usePrefersReducedMotion();
  const turnNavItems = React.useMemo<ConversationTurnNavItem[]>(
    () => deriveConversationTurnNavItems(canonicalConversation.turns),
    [canonicalConversation.turns],
  );
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState("");
  const [renamingSession, setRenamingSession] = React.useState(false);
  const activeSessionIdRef = React.useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
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
    if (
      isConversationLoading ||
      canonicalConversation.loading ||
      canonicalConversation.state?.thread.id !== activeSessionId ||
      !activeSessionId
    ) {
      return;
    }
    if (scrollRestoredRef.current === activeSessionId) return;
    const saved = loadConversationUiState(activeSessionId);
    if (saved?.mainScrollTop && !timelineListRef.current) return;
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
  }, [
    activeSessionId,
    canonicalConversation.loading,
    canonicalConversation.state,
    isConversationLoading,
  ]);

  const handleRefreshDiff = React.useCallback(() => {
    if (isRefreshingDiff) return;
    setIsRefreshingDiff(true);
    try {
      onRefreshDiff();
    } finally {
      window.setTimeout(() => setIsRefreshingDiff(false), 600);
    }
  }, [isRefreshingDiff, onRefreshDiff]);
  const changedFileCount = workspacePath ? (gitStatus?.files.length ?? 0) : 0;
  const composerExecutionPlan = findLatestExecutionPlan(
    canonicalConversation.turns,
  );
  const showComposerStatusSummary = shouldShowComposerStatusSummary({
    hasPlan: composerExecutionPlan !== null,
    changedFileCount,
  });
  const composerDiffSummary = React.useMemo(() => summarizeDiff(diff), [diff]);
  const sourceLinks = canonicalAuxiliary.sourceLinks;
  const canonicalSummaryEvents = React.useMemo<DesktopSessionEvent[]>(
    () =>
      canonicalConversation.turns.flatMap((turn) =>
        turn.planItem
          ? [
              {
                id: turn.planItem.id,
                sessionId: activeSessionId ?? "canonical",
                type: "proposed_plan" as const,
                role: "assistant" as const,
                content: turn.planItem.markdown,
                createdAt: new Date(turn.planItem.createdAt).toISOString(),
              },
            ]
          : [],
      ),
    [activeSessionId, canonicalConversation.turns],
  );
  const threadSummaryModel = React.useMemo(
    () =>
      deriveThreadSummaryViewModel({
        additions: composerDiffSummary.additions,
        branchName,
        changedFileCount,
        deletions: composerDiffSummary.deletions,
        events: canonicalSummaryEvents,
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
      canonicalSummaryEvents,
      workspacePath,
    ],
  );
  const workflowMainRef = React.useRef<HTMLElement>(null);
  const threadSummary = useThreadSummaryController(workflowMainRef);
  const fallbackTitle = canonicalAuxiliary.fallbackTitle ?? "新对话";
  const renderedSessionTitle = sessionTitle ?? fallbackTitle;
  const hasActiveSession = Boolean(activeSessionId);
  const isSessionPinned = Boolean(activeSessionPinnedAt);
  const canRegenerateSessionTitle = canRegenerateConversationTitle({
    hasActiveSession,
    hasFirstMessage: canonicalAuxiliary.fallbackTitle !== null,
    pending: titleRegenerating,
    status: sessionStatus,
  });
  const selectedOpenTarget =
    openTargets.find((target) => target.id === defaultOpenTargetId) ??
    FALLBACK_OPEN_TARGETS[0];
  const activePermissionRequest = pendingPermissions[0] ?? null;
  const composerMode = workflowComposerMode(activePermissionRequest);
  const composerTransition = useHeightTransition([
    composerMode,
    activePermissionRequest?.requestId ?? "",
    showComposerStatusSummary,
    composerExecutionPlan,
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

  const openRenameSessionDialog = React.useCallback((): void => {
    if (!hasActiveSession || renameDialogOpen || renamingSession) return;
    setSessionMenuOpen(false);
    setRenameValue(editableSessionTitle ?? renderedSessionTitle);
    setRenameDialogOpen(true);
  }, [
    editableSessionTitle,
    hasActiveSession,
    renameDialogOpen,
    renderedSessionTitle,
    renamingSession,
  ]);

  async function submitSessionRename(): Promise<void> {
    const title = renameValue.trim();
    if (!activeSessionId || renamingSession || !title) return;
    const requestedSessionId = activeSessionId;
    setRenamingSession(true);
    try {
      const renamed = await onRenameSession(title);
      if (shouldCloseConversationRenameDialog({
        activeSessionId: activeSessionIdRef.current,
        requestedSessionId,
        succeeded: renamed,
      })) {
        setRenameDialogOpen(false);
      }
    } finally {
      setRenamingSession(false);
    }
  }

  const regenerateCurrentSessionTitle = React.useCallback(async (): Promise<void> => {
    if (!canRegenerateSessionTitle) return;
    setSessionMenuOpen(false);
    try {
      await onRefreshSessionTitle();
    } catch (error) {
      window.dispatchEvent(new CustomEvent("desktop:error", { detail: error }));
    }
  }, [canRegenerateSessionTitle, onRefreshSessionTitle]);

  React.useEffect(() => {
    setRenameDialogOpen(false);
    setRenameValue("");
  }, [activeSessionId]);

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
        <span
          aria-busy={titleRegenerating}
          aria-live="polite"
          className="chat-session-title__text"
        >
          {isConversationLoading ? (
            "加载对话中"
          ) : titleRegenerating ? (
            <>
              <SkeletonBlock className="chat-session-title__skeleton" />
              <span className="u-sr-only">正在更新会话标题</span>
            </>
          ) : renderedSessionTitle}
        </span>
        <PopoverMenu
          align="start"
          className="popover-session-actions popover-menu--grid"
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
            disabled={!hasActiveSession || renamingSession}
            icon={<Pencil size={APP_ICON_SIZE} />}
            onClick={openRenameSessionDialog}
          >
            重命名对话
          </PopoverItem>
          <PopoverItem
            disabled={!canRegenerateSessionTitle}
            icon={<Sparkles size={APP_ICON_SIZE} />}
            onClick={() => void regenerateCurrentSessionTitle()}
          >
            {titleRegenerating ? "正在更新会话标题…" : "更新会话标题"}
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
      canRegenerateSessionTitle,
      hasActiveSession,
      isConversationLoading,
      isSessionPinned,
      openRenameSessionDialog,
      regenerateCurrentSessionTitle,
      titleRegenerating,
      renamingSession,
      renderedSessionTitle,
      sessionMenuOpen,
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
            className="popover-open-targets popover-menu--grid"
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
          <ComposerChangeSummary
            active={
              sessionStatus === "running" || sessionStatus === "waiting"
            }
            additions={composerDiffSummary.additions}
            changedFileCount={changedFileCount}
            deletions={composerDiffSummary.deletions}
            executionPlan={composerExecutionPlan}
            failed={sessionStatus === "error"}
            onOpenReview={openReviewSidebar}
          />
        ) : null}
        {activePermissionRequest ? (
          <InlineApprovalCard
            request={activePermissionRequest}
            currentPermissionMode={permissionMode}
            onDecide={onDecidePermission}
          />
        ) : (
          <DesktopComposer
            {...composerProps}
            contextUsage={canonicalAuxiliary.contextUsage}
            hasConversationMessages={
              canonicalAuxiliary.hasConversationMessages
            }
            messages={[]}
          />
        )}
      </ComposerFrame>
    </div>
  ) : null;
  const canonicalThreadView = activeSessionId ? (
    <CanonicalThreadView
      active={sessionStatus === "running" || sessionStatus === "waiting"}
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
      <ConfirmationDialog
        actionDisabled={renamingSession || renameValue.trim().length === 0}
        actionLabel={renamingSession ? "重命名中…" : "重命名"}
        input={{
          value: renameValue,
          onChange: setRenameValue,
          maxLength: 160,
          placeholder: "输入对话名称",
        }}
        open={renameDialogOpen}
        title="重命名对话"
        onAction={() => void submitSessionRename()}
        onCancel={() => {
          if (!renamingSession) setRenameDialogOpen(false);
        }}
      />
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
              layout="flex"
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
                          {canonicalThreadView}
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
          className="popover-surface popover popover-sub-content popover-menu--grid"
          sideOffset={16}
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
