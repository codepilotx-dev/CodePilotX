import React from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AppWindow,
  Archive,
  Bot,
  ChevronRight,
  Copy,
  GitFork,
  LayoutList,
  MessagesSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Menu,
  Pencil,
  Pin,
  Sparkles,
  Workflow,
} from "lucide-react";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import type {
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionStatus,
} from "../../../../shared/types.js";
import { useQuickChatContext } from "../QuickChatContext.js";
import { useDesktopSettings } from "../../settings/useDesktopSettings.js";
import { WorkspaceHeaderItem } from "../../layout/workspace-header/index.js";
import { useHeightTransition } from "../../../hooks/useHeightTransition.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";
import {
  enterTween,
  exitTween,
  motionTransition,
} from "../../motion/motionTransitions.js";
import { desktopClient } from "../../../services/desktop-client/index.js";
import { InlineApprovalCard } from "../approvals/InlineApprovalCard.js";
import {
  ComposerChangeSummary,
  findLatestExecutionPlan,
} from "../composer/ComposerChangeSummary.js";
import { deriveConversationChangeSummary } from "../composer/conversationChangeSummary.js";
import {
  clearConversationSelectionHighlight,
  createConversationSelectionSnapshot,
  installConversationSelectionHighlight,
} from "./conversationSelectionHighlight.js";
import {
  PopoverCheckboxItem,
  PopoverItem,
  PopoverSeparator,
} from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { AppContextMenu } from "../../../components/ui/AppContextMenu.js";
import { FullScreenWhaleLoading } from "../../../components/ui/FullScreenWhaleLoading.js";
import { buildPopoverSizingStyle } from "../../../components/ui/popoverSizing.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { InputDialog } from "../../../components/ui/ConfirmationDialog.js";
import { SkeletonBlock } from "../../../components/ui/Skeleton.js";
import {
  loadConversationUiState,
  patchConversationUiState,
} from "../../layout/tabs/conversationUiState.js";
import { CanonicalThreadView } from "../timeline/CanonicalThreadView.js";
import { normalizePatchActionError } from "../timeline/patchActionError.js";
import { subagentStatusLabel } from "../subagents/subagentStatusLabel.js";
import { ConversationItemContext } from "../timeline/ConversationItemContext.js";
import type { ThreadTimelineNavigationHandle } from "../timeline/SessionTimelineView.js";
import { ThreadComposerDock } from "./ThreadComposerDock.js";
import { ThreadScrollLayout } from "./ThreadScrollLayout.js";
import {
  ConversationTurnNavRail,
  type TurnNavigationReason,
} from "./ConversationTurnNavRail.js";
import { useConversationTurnRowVisibility } from "./useConversationTurnRowVisibility.js";
import {
  ThreadSummaryErrorBoundary,
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
  canInlineEditConversationTitle,
  canRegenerateConversationTitle,
  normalizeConversationTitle,
  shouldCloseConversationRenameDialog,
} from "./conversationTitleActions.js";
import { useConversationForkController } from "../workflow/fork/useConversationForkController.js";
import { findLatestConversationForkPoint } from "../workflow/fork/latestConversationForkPoint.js";
import {
  copySessionReference,
  copyThreadDeepLink,
  copyThreadId,
  copyWorkspaceCwd,
  resolveSessionReferenceShortcut,
  type SessionReferenceContext,
} from "./sessionReferenceActions.js";
export { deriveConversationTurnNavItems } from "./turnNavigationModel.js";
export type { ConversationTurnNavItem } from "./turnNavigationModel.js";
const DesktopComposer = React.lazy(() => import("../composer/DesktopComposer.js").then(module => ({ default: module.DesktopComposer })));

const ConversationEnvironmentControls = React.lazy(() =>
  import("../workflow/ConversationEnvironmentControls.js").then((module) => ({
    default: module.ConversationEnvironmentControls,
  }))
);

const WORKSPACE_HEADER_ICON_SIZE = 16;

async function chooseSessionGroupForThread(threadId: string): Promise<void> {
  const groups = await desktopClient.listSessionGroups()
  const choices = groups.map((group, index) => `${index + 1}. ${group.name}`).join('\n')
  const answer = globalThis.prompt(`输入会话组序号；输入 0 移出会话组：\n${choices}`)?.trim()
  if (answer === undefined) return
  const index = Number(answer)
  const groupId = index === 0 ? null : groups[index - 1]?.id
  if (index !== 0 && !groupId) return
  await desktopClient.setSessionGroupMembership({ threadId, groupId })
}

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

export function ConversationPage(): React.ReactNode {
  const navigate = useNavigate();
  const {
    isConversationLoading,
    activeSessionId,
    activeSessionPinnedAt,
    sessionTitle,
    editableSessionTitle,
    titleRegenerating,
    sessionStatus,
    projectDetailsTrigger,
    workspacePath,
    branchName,
    branches,
    diff,
    gitStatus,
    onArchiveSession,
    onCreateBranch,
    onOpenAutomation,
    onOpenWorkspacePath,
    onOpenPatchReview,
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
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    onOpenAttachment,
    onSubmitEditedUserMessage,
    onAppendComposerText,
    onAppendSideChatText,
    onOpenSideChat,
    sideChatAvailable,
    onOpenSubagent,
    permissionMode,
    composerProps,
    layoutResizeActive,
    rightDockPlanEventId,
  } = useQuickChatContext();
  const {
    conversationWidth,
    diffMarkerStyle,
    reviewView,
    draft: settingsDraft,
    setSidebarSessionPins,
  } = useDesktopSettings();
  const canonicalConversation = useCanonicalThreadConversation(activeSessionId);
  const subagents = React.useMemo(
    () => canonicalConversation.state
      ? [...canonicalConversation.state.subagentsByTaskId.values()]
      : [],
    [canonicalConversation.state],
  );
  const canonicalAuxiliary = React.useMemo(
    () =>
      selectCanonicalConversationAuxiliaryState(canonicalConversation.state),
    [canonicalConversation.state],
  );
  const isThreadLoading =
    isConversationLoading ||
    (canonicalConversation.loading && canonicalConversation.turns.length === 0);
  const effectiveSessionStatus =
    canonicalAuxiliary.sessionStatus ?? sessionStatus;
  const navigateToForkTarget = React.useCallback((targetThreadId: string) => {
    navigate(`/threads/${encodeURIComponent(targetThreadId)}`);
  }, [navigate]);
  const conversationFork = useConversationForkController({
    canUseNewWorktree: Boolean(workspacePath && (branchName || gitStatus)),
    sourceRunning:
      effectiveSessionStatus === "running" ||
      effectiveSessionStatus === "waiting" ||
      effectiveSessionStatus === "queued",
    sourceThreadId: activeSessionId,
    onNavigateTarget: navigateToForkTarget,
  });
  const pendingPermissions = canonicalAuxiliary.pendingPermissions;
  const reduceMotion = usePrefersReducedMotion();
  const turnNavItems = React.useMemo<ConversationTurnNavItem[]>(
    () => deriveConversationTurnNavItems(canonicalConversation.turns),
    [canonicalConversation.turns],
  );
  const latestConversationForkPoint = React.useMemo(
    () => findLatestConversationForkPoint(canonicalConversation.turns),
    [canonicalConversation.turns],
  );
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState("");
  const [renamingSession, setRenamingSession] = React.useState(false);
  const [isInlineEditing, setIsInlineEditing] = React.useState(false);
  const [inlineTitleValue, setInlineTitleValue] = React.useState("");
  const isComposingRef = React.useRef(false);
  const skipNextBlurSaveRef = React.useRef(false);
  const editStartTimeRef = React.useRef(0);
  const inlineInputRef = React.useRef<HTMLInputElement | null>(null);
  const activeSessionIdRef = React.useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  React.useEffect(() => {
    setIsInlineEditing(false);
    skipNextBlurSaveRef.current = false;
  }, [activeSessionId]);

  const handleInlineInputRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      inlineInputRef.current = node;
      if (node) {
        node.focus();
        node.select();
        const frame = requestAnimationFrame(() => {
          node.focus();
          node.select();
        });
        return () => cancelAnimationFrame(frame);
      }
    },
    [],
  );

  const [conversationSelectedText, setConversationSelectedText] =
    React.useState("");
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
  const [timelineBottomState, setTimelineBottomState] = React.useState<{
    sessionId: string | null;
    canReturnToBottom: boolean;
  }>({
    sessionId: null,
    canReturnToBottom: false,
  });
  const canReturnTimelineToBottom =
    timelineBottomState.sessionId === activeSessionId &&
    timelineBottomState.canReturnToBottom;
  const handleCanReturnToBottomChange = React.useCallback(
    (canReturnToBottom: boolean): void => {
      setTimelineBottomState({
        sessionId: activeSessionId,
        canReturnToBottom,
      });
    },
    [activeSessionId],
  );
  const returnTimelineToBottom = React.useCallback((): void => {
    timelineNavigationRef.current?.returnToBottom();
  }, []);
  const threadScrollRef = React.useRef<HTMLDivElement | null>(null);
  const turnNavItemIds = React.useMemo(
    () => turnNavItems.map((item) => item.id),
    [turnNavItems],
  );
  const { registerTurnRow, visibilityStore } =
    useConversationTurnRowVisibility(turnNavItemIds, threadScrollRef);
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
                "color-mix(in srgb, var(--cpx-sys-color-fg-primary) 14%, transparent)",
            },
            {
              backgroundColor:
                "color-mix(in srgb, var(--cpx-sys-color-fg-primary) 14%, transparent)",
              offset: 0.35,
            },
            {
              backgroundColor:
                "color-mix(in srgb, var(--cpx-sys-color-fg-primary) 5%, transparent)",
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
      patchConversationUiState(sessionId, {
        mainScrollTop: mainScrollTopRef.current,
      });
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
  const workspaceChangedFileCount = workspacePath
    ? (gitStatus?.files.length ?? 0)
    : 0;
  const composerExecutionPlan = findLatestExecutionPlan(
    canonicalConversation.turns,
  );
  const conversationChangeSummary = React.useMemo(
    () => deriveConversationChangeSummary(canonicalConversation.turns, gitStatus),
    [canonicalConversation.turns, gitStatus],
  );
  const showComposerStatusSummary = shouldShowComposerStatusSummary({
    hasPlan: composerExecutionPlan !== null,
    changedFileCount: conversationChangeSummary.files.length,
  });
  const workspaceDiffSummary = React.useMemo(() => summarizeDiff(diff), [diff]);
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
        additions: workspaceDiffSummary.additions,
        branchName,
        changedFileCount: workspaceChangedFileCount,
        deletions: workspaceDiffSummary.deletions,
        events: canonicalSummaryEvents,
        sources: sourceLinks,
        subagents,
        workspacePath,
      }),
    [
      branchName,
      workspaceChangedFileCount,
      workspaceDiffSummary,
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
    status: effectiveSessionStatus,
  });
  const canInlineEdit = canInlineEditConversationTitle({
    hasActiveSession,
    isLoading: isThreadLoading,
    isRegenerating: titleRegenerating,
    isRenaming: renamingSession,
  });

  React.useEffect(() => {
    if (isInlineEditing && !canInlineEdit && !renamingSession) {
      setIsInlineEditing(false);
      skipNextBlurSaveRef.current = false;
    }
  }, [canInlineEdit, isInlineEditing, renamingSession]);

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
    let hiddenRoot: HTMLElement | null = null;
    let observer: MutationObserver | null = null;
    let revealTimeout: number | null = null;

    const clearHiddenRoot = (): void => {
      observer?.disconnect();
      observer = null;
      if (revealTimeout !== null) {
        window.clearTimeout(revealTimeout);
        revealTimeout = null;
      }
      hiddenRoot?.style.removeProperty("visibility");
      hiddenRoot = null;
    };
    const hideUntilTimelineChanges = (): void => {
      clearHiddenRoot();
      const root = workflowPageRef.current?.querySelector<HTMLElement>(
        ".canonical-thread-view",
      );
      if (!root) return;
      const previousThreadId = root.dataset.canonicalThreadId;
      hiddenRoot = root;
      root.style.visibility = "hidden";
      const revealReplacement = (): void => {
        const current = workflowPageRef.current?.querySelector<HTMLElement>(
          ".canonical-thread-view",
        );
        if (
          !hiddenRoot?.isConnected ||
          current !== hiddenRoot ||
          current.dataset.canonicalThreadId !== previousThreadId
        ) {
          clearHiddenRoot();
        }
      };
      observer = new MutationObserver(revealReplacement);
      observer.observe(root, {
        attributeFilter: ["data-canonical-thread-id"],
        attributes: true,
      });
      if (root.parentElement) {
        observer.observe(root.parentElement, {
          childList: true,
        });
      }
      revealTimeout = window.setTimeout(clearHiddenRoot, 1_000);
    };

    window.addEventListener("hashchange", hideUntilTimelineChanges);
    return () => {
      window.removeEventListener("hashchange", hideUntilTimelineChanges);
      clearHiddenRoot();
    };
  }, []);
  function closeSessionMenu(): void {
    setSessionMenuOpen(false);
  }

  const sessionReferenceContext = React.useMemo<SessionReferenceContext>(
    () => ({
      workspaceCwd: workspacePath ?? "",
      threadId: activeSessionId ?? "",
    }),
    [activeSessionId, workspacePath],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const payload = resolveSessionReferenceShortcut(
        event,
        sessionReferenceContext,
      );
      if (!payload) return;
      const value =
        payload.kind === "workspaceCwd"
          ? payload.workspaceCwd
          : payload.threadId;
      if (!value) return;
      event.preventDefault();
      void copySessionReference(payload);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionReferenceContext]);

  const openRenameSessionDialog = React.useCallback((): void => {
    if (!hasActiveSession || renameDialogOpen || renamingSession) return;
    if (isInlineEditing) {
      setIsInlineEditing(false);
      skipNextBlurSaveRef.current = true;
    }
    setSessionMenuOpen(false);
    setRenameValue(editableSessionTitle ?? renderedSessionTitle);
    setRenameDialogOpen(true);
  }, [
    editableSessionTitle,
    hasActiveSession,
    isInlineEditing,
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

  const startInlineEdit = React.useCallback((): void => {
    if (!canInlineEdit || isInlineEditing) return;
    editStartTimeRef.current = Date.now();
    setInlineTitleValue(editableSessionTitle ?? renderedSessionTitle);
    setIsInlineEditing(true);
    skipNextBlurSaveRef.current = false;
  }, [canInlineEdit, editableSessionTitle, isInlineEditing, renderedSessionTitle]);

  const submitInlineRename = React.useCallback(
    async (options?: { fromBlur?: boolean }): Promise<void> => {
      if (options?.fromBlur) {
        if (skipNextBlurSaveRef.current) {
          skipNextBlurSaveRef.current = false;
          return;
        }
        if (Date.now() - editStartTimeRef.current < 200) {
          return;
        }
      }

      if (!activeSessionId || renamingSession || isComposingRef.current) return;

      const currentTitle = editableSessionTitle ?? renderedSessionTitle;
      const trimmed = normalizeConversationTitle(inlineTitleValue);

      // Empty title: cancel and revert to original
      if (!trimmed) {
        setIsInlineEditing(false);
        setInlineTitleValue(currentTitle);
        skipNextBlurSaveRef.current = false;
        return;
      }

      // Name unchanged: exit without request
      if (trimmed === normalizeConversationTitle(currentTitle)) {
        setIsInlineEditing(false);
        skipNextBlurSaveRef.current = false;
        return;
      }

      const requestedSessionId = activeSessionId;
      setRenamingSession(true);
      try {
        const renamed = await onRenameSession(trimmed);
        if (
          shouldCloseConversationRenameDialog({
            activeSessionId: activeSessionIdRef.current,
            requestedSessionId,
            succeeded: Boolean(renamed),
          })
        ) {
          setIsInlineEditing(false);
          skipNextBlurSaveRef.current = false;
        } else {
          // Save failed: keep isInlineEditing = true, retain input value
          skipNextBlurSaveRef.current = false;
        }
      } catch {
        // Save failed: keep isInlineEditing = true, retain input value
        skipNextBlurSaveRef.current = false;
      } finally {
        setRenamingSession(false);
      }
    },
    [
      activeSessionId,
      editableSessionTitle,
      inlineTitleValue,
      onRenameSession,
      renamingSession,
      renderedSessionTitle,
    ],
  );

  const handleInlineKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      skipNextBlurSaveRef.current = true;
      setIsInlineEditing(false);
      setInlineTitleValue(editableSessionTitle ?? renderedSessionTitle);
      return;
    }

    if (event.key === "Enter") {
      if (
        isComposingRef.current ||
        (event.nativeEvent as KeyboardEvent).isComposing ||
        event.keyCode === 229
      ) {
        return;
      }
      event.preventDefault();
      skipNextBlurSaveRef.current = true;
      void submitInlineRename();
    }
  };

  const handleInlineBlur = (): void => {
    void submitInlineRename({ fromBlur: true });
  };

  const handleTitleKeyDown = (
    event: React.KeyboardEvent<HTMLSpanElement>,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startInlineEdit();
    }
  };

  const regenerateCurrentSessionTitle = React.useCallback(async (): Promise<void> => {
    if (!canRegenerateSessionTitle) return;
    setSessionMenuOpen(false);
    try {
      await onRefreshSessionTitle();
    } catch (error) {
      window.dispatchEvent(new CustomEvent("desktop:error", { detail: error }));
    }
  }, [canRegenerateSessionTitle, onRefreshSessionTitle]);

  const openConversationInNewWindow = React.useCallback((): void => {
    if (!activeSessionId) return;
    setSessionMenuOpen(false);
    void desktopClient.openWindow({
      kind: "thread",
      threadId: activeSessionId,
    }).catch((error) => {
      window.dispatchEvent(new CustomEvent("desktop:error", { detail: error }));
    });
  }, [activeSessionId]);

  React.useEffect(() => {
    setRenameDialogOpen(false);
    setRenameValue("");
  }, [activeSessionId]);

  function copyWorkspaceReference(): void {
    closeSessionMenu();
    if (!workspacePath) return;
    void copyWorkspaceCwd(workspacePath);
  }

  function copyThreadReference(): void {
    closeSessionMenu();
    if (!activeSessionId) return;
    void copyThreadId(activeSessionId);
  }

  function copyThreadDeepLinkReference(): void {
    closeSessionMenu();
    if (!activeSessionId) return;
    void copyThreadDeepLink(activeSessionId);
  }

  function continueInNewConversation(): void {
    closeSessionMenu();
    if (!latestConversationForkPoint) return;
    conversationFork.onForkFromMessage?.(latestConversationForkPoint);
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

  const openReviewSidebar = React.useCallback((): void => {
    onRefreshDiff();
    onOpenRightDock("review");
  }, [onOpenRightDock, onRefreshDiff]);

  const applyThreadPatch = React.useCallback(
    async (
      itemId: string,
      action: "undo" | "reapply",
      expectedVersion: number,
    ): Promise<void> => {
      if (!activeSessionId) return;
      try {
        await desktopClient.applyThreadPatch({
          threadId: activeSessionId,
          itemId,
          action,
          expectedVersion,
        });
        await canonicalConversation.reload();
        onRefreshDiff();
      } catch (error) {
        throw normalizePatchActionError(error, action);
      }
    },
    [
      activeSessionId,
      canonicalConversation,
      onRefreshDiff,
    ],
  );

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
    () => {
      return (
      <div className="chat-session-title">
        {projectDetailsTrigger}
        {isInlineEditing ? (
          <input
            autoFocus
            ref={handleInlineInputRef}
            aria-label="重命名对话"
            className="chat-session-title__input"
            disabled={renamingSession}
            maxLength={160}
            type="text"
            value={inlineTitleValue}
            onBlur={handleInlineBlur}
            onChange={(e) => setInlineTitleValue(e.target.value)}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onKeyDown={handleInlineKeyDown}
          />
        ) : (
          <span
            aria-busy={titleRegenerating}
            aria-label={
              canInlineEdit
                ? `重命名对话：${renderedSessionTitle}`
                : undefined
            }
            aria-live="polite"
            className="chat-session-title__text"
            role={canInlineEdit ? "button" : undefined}
            tabIndex={canInlineEdit ? 0 : undefined}
            title={renderedSessionTitle}
            onClick={canInlineEdit ? startInlineEdit : undefined}
            onKeyDown={canInlineEdit ? handleTitleKeyDown : undefined}
          >
            {isThreadLoading ? (
              "加载对话中"
            ) : titleRegenerating ? (
              <>
                <SkeletonBlock className="chat-session-title__skeleton" />
                <span className="u-sr-only">正在更新会话标题</span>
              </>
            ) : (
              renderedSessionTitle
            )}
          </span>
        )}
        <PopoverMenu
          align="start"
          className="popover-session-actions popover-menu--grid"
          open={sessionMenuOpen}
          width={220}
          trigger={
            <IconButton
              color="ghostSecondary"
              size="toolbar"
              title="更多会话操作"
            >
              <MoreHorizontal
                size={WORKSPACE_HEADER_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </IconButton>
          }
          onOpenChange={setSessionMenuOpen}
        >
          <PopoverCheckboxItem
            checked={isSessionPinned}
            icon={<Pin size={APP_ICON_SIZE} />}
            shortcut="Ctrl+Alt+P"
            disabled={!hasActiveSession}
            onCheckedChange={toggleSessionPinned}
          >
            置顶对话
          </PopoverCheckboxItem>
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
          <PopoverSeparator />
          <PopoverItem
            disabled={!activeSessionId || effectiveSessionStatus === "running" || effectiveSessionStatus === "waiting" || effectiveSessionStatus === "queued"}
            icon={<MessagesSquare size={APP_ICON_SIZE} />}
            onClick={() => {
              closeSessionMenu()
              if (activeSessionId) void chooseSessionGroupForThread(activeSessionId)
            }}
          >
            {effectiveSessionStatus === "running" || effectiveSessionStatus === "waiting" || effectiveSessionStatus === "queued"
              ? "当前 Turn 结束后可切换"
              : "加入或切换会话组"}
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem
            disabled={!hasActiveSession || !sideChatAvailable}
            icon={<MessageSquarePlus size={APP_ICON_SIZE} />}
            onClick={onOpenSideChat}
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
              onClick={copyWorkspaceReference}
            >
              复制工作目录
            </PopoverItem>
            <PopoverItem
              disabled={!hasActiveSession}
              icon={<Copy size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+C"
              onClick={copyThreadReference}
            >
              复制会话 ID
            </PopoverItem>
            <PopoverItem
              disabled={!hasActiveSession}
              icon={<Copy size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+L"
              onClick={copyThreadDeepLinkReference}
            >
              复制深度链接
            </PopoverItem>
          </SessionSubmenu>
          <SessionSubmenu
            disabled={!conversationFork.onForkFromMessage || !latestConversationForkPoint}
            icon={<GitFork size={APP_ICON_SIZE} />}
            label="继续到…"
          >
            <PopoverItem
              disabled={!conversationFork.onForkFromMessage || !latestConversationForkPoint}
              icon={<GitFork size={APP_ICON_SIZE} />}
              onClick={continueInNewConversation}
            >
              在新聊天中继续
            </PopoverItem>
          </SessionSubmenu>
          <PopoverItem
            icon={<Workflow size={APP_ICON_SIZE} />}
            onClick={openAutomationView}
          >
            添加自动化...
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem
            disabled={!activeSessionId}
            icon={<AppWindow size={APP_ICON_SIZE} />}
            onClick={openConversationInNewWindow}
          >
            在新窗口中打开
          </PopoverItem>
        </PopoverMenu>
      </div>
      )
    },
    [
      activeSessionId,
      canInlineEdit,
      canRegenerateSessionTitle,
      conversationFork.onForkFromMessage,
      handleInlineBlur,
      handleInlineInputRef,
      handleInlineKeyDown,
      handleTitleKeyDown,
      hasActiveSession,
      inlineTitleValue,
      isInlineEditing,
      isThreadLoading,
      isSessionPinned,
      latestConversationForkPoint,
      openRenameSessionDialog,
      openConversationInNewWindow,
      regenerateCurrentSessionTitle,
      startInlineEdit,
      titleRegenerating,
      renamingSession,
      renderedSessionTitle,
      sessionMenuOpen,
      projectDetailsTrigger,
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
        <IconButton
          color={threadSummary.displayMode === "overlay"
            ? threadSummary.isPopoverOpen ? "ghostActive" : "ghostSecondary"
            : threadSummary.isPinned ? "ghostActive" : "ghostSecondary"}
          title={
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
          size="toolbar"
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
        </IconButton>
      );

      return (
        <div className="chat-session-actions">
        <IconButton
          color="ghostSecondary"
          size="toolbar"
          title={`页面宽度：${{ default: "默认", narrow: "窄", wide: "宽" }[conversationWidth]}，点击切换为${{ default: "窄", narrow: "宽", wide: "默认" }[conversationWidth]}`}
          onClick={() => {
            settingsDraft.setValue("conversationWidth", current =>
              current === "default" ? "narrow" : current === "narrow" ? "wide" : "default",
            );
            settingsDraft.autoSave();
          }}
        >
          <Menu
            className="conversation-width-icon"
            data-width={conversationWidth}
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </IconButton>
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
      activeSessionId,
      conversationWidth,
      onBranchSelect,
      onCommitOrPush,
      onCreateBranch,
      onCreatePullRequest,
      onOpenPlanInRightDock,
      onOpenSubagent,
      onOpenWorkspacePath,
      navigate,
      settingsDraft.setValue,
      settingsDraft.autoSave,
      settingsDraft.values.terminalProfileId,
      setSidebarSessionPins,
      threadSummary,
      threadSummaryModel,
      workspacePath,
    ],
  );

  const composerFooter = !isThreadLoading && composerProps ? (
    <ThreadComposerDock
      ref={composerTransition.ref}
      style={composerTransition.style}
    >
        <AnimatePresence initial={false}>
          {showComposerStatusSummary ? (
            <ComposerFooterPresence
              key="composer-change-summary"
              reducedMotion={reduceMotion}
            >
              <ComposerChangeSummary
                active={
                  effectiveSessionStatus === "running" ||
                  effectiveSessionStatus === "waiting"
                }
                additions={conversationChangeSummary.additions}
                canReturnToBottom={canReturnTimelineToBottom}
                changedFiles={conversationChangeSummary.files}
                deletions={conversationChangeSummary.deletions}
                executionPlan={composerExecutionPlan}
                failed={effectiveSessionStatus === "error"}
                onOpenReview={openReviewSidebar}
                onOpenReviewFile={onOpenPatchReview}
                onReturnToBottom={returnTimelineToBottom}
              />
            </ComposerFooterPresence>
          ) : null}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {activePermissionRequest ? (
            <ComposerFooterPresence
              key={activePermissionRequest.requestId}
              reducedMotion={reduceMotion}
            >
              <InlineApprovalCard
                request={activePermissionRequest}
                currentPermissionMode={permissionMode}
                onDecide={onDecidePermission}
              />
            </ComposerFooterPresence>
          ) : null}
        </AnimatePresence>
        {!activePermissionRequest ? (
          <DesktopComposer
            {...composerProps}
            canForkConversation={Boolean(
              conversationFork.onForkFromMessage && latestConversationForkPoint,
            )}
            onArchiveConversation={archiveCurrentSession}
            onForkConversation={continueInNewConversation}
            sessionStatus={effectiveSessionStatus}
            contextUsage={canonicalAuxiliary.contextUsage}
            queuedFollowUps={canonicalAuxiliary.queuedFollowUps}
            queuePauseReason={canonicalAuxiliary.queuePauseReason}
            hasConversationMessages={
              canonicalAuxiliary.hasConversationMessages
            }
            messages={[]}
          />
        ) : null}
    </ThreadComposerDock>
  ) : null;
  const conversationItemContextValue = React.useMemo(
    () => ({
      canCopyFileReferenceContents,
      onCopyFileReferenceContents,
      onOpenFileReference,
      onOpenAttachment,
      onForkFromMessage: conversationFork.onForkFromMessage,
      onSubmitEditedUserMessage,
      sessionStatus: effectiveSessionStatus,
      workspacePath,
    }),
    [
      canCopyFileReferenceContents,
      onCopyFileReferenceContents,
      onOpenFileReference,
      onOpenAttachment,
      conversationFork.onForkFromMessage,
      onSubmitEditedUserMessage,
      effectiveSessionStatus,
      workspacePath,
    ],
  );
  const canonicalThreadView = activeSessionId ? (
    <ConversationItemContext.Provider value={conversationItemContextValue}>
      <CanonicalThreadView
        active={
          effectiveSessionStatus === "running" ||
          effectiveSessionStatus === "waiting"
        }
        diffMarkerStyle={diffMarkerStyle}
        error={canonicalConversation.error}
        hasOlder={canonicalConversation.hasOlder}
        initialScrollOffset={initialTimelineScrollTop}
        layoutResizeActive={layoutResizeActive}
        listRef={timelineListRef}
        navigationRef={timelineNavigationRef}
        loading={canonicalConversation.loading}
        loadingOlder={canonicalConversation.loadingOlder}
        onCanReturnToBottomChange={handleCanReturnToBottomChange}
        onApplyPatch={applyThreadPatch}
        onLoadOlder={canonicalConversation.loadOlder}
        onOpenPatchReview={onOpenPatchReview}
        onOpenPlanInRightDock={onOpenPlanInRightDock}
        onOpenSubagent={onOpenSubagent}
        onReload={canonicalConversation.reload}
        onScroll={handleTimelineScroll}
        registerTurnRow={registerTurnRow}
        rightDockPlanEventId={rightDockPlanEventId}
        readThreadPatchDiff={desktopClient.readThreadPatchDiff}
        scrollRef={threadScrollRef}
        threadId={activeSessionId}
        turns={canonicalConversation.turns}
      />
    </ConversationItemContext.Provider>
  ) : null;
  return (
    <section
      ref={workflowPageRef}
      data-conversation-width={conversationWidth}
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
      <InputDialog
        actionDisabled={renamingSession || renameValue.trim().length === 0}
        actionLabel={renamingSession ? "重命名中…" : "重命名"}
        description="输入新的对话名称。"
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
      {conversationFork.dialog}
      {activeSessionId && workspacePath ? (
        <React.Suspense fallback={null}>
          <ConversationEnvironmentControls
            gitAvailable={Boolean(gitStatus)}
            terminalProfileId={settingsDraft.values.terminalProfileId}
            threadId={activeSessionId}
            workspacePath={workspacePath}
            onOpenEnvironmentSettings={() => {
              navigate(`/settings/local-environment?threadId=${encodeURIComponent(activeSessionId)}`)
            }}
            onOpenWorktreeSettings={projectId => {
              navigate(`/settings/worktrees?projectId=${encodeURIComponent(projectId)}`)
            }}
            onTransferAuxiliaryState={targetThreadId => {
              setSidebarSessionPins(current => {
                const pinnedAt = current[activeSessionId]
                return pinnedAt ? { ...current, [targetThreadId]: pinnedAt } : current
              })
            }}
            onNavigateTarget={targetThreadId => {
              navigate(`/threads/${encodeURIComponent(targetThreadId)}`)
            }}
          />
        </React.Suspense>
      ) : null}
      <div
        className="workflow-page__body"
      >
        <main
          ref={workflowMainRef}
          className="workflow-page__main"
          data-thread-summary-inline={
            threadSummary.shouldShowInline || undefined
          }
          data-thread-summary-mode={threadSummary.displayMode}
        >
          <div className="workflow-main-scroll-frame">
            <ConversationTurnNavRail
              items={turnNavItems}
              onNavigate={handleTurnNavigate}
              visibilityStore={visibilityStore}
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
                        disabled: !sideChatAvailable,
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
                      {isThreadLoading ? (
                        <FullScreenWhaleLoading
                          label="正在加载会话内容…"
                          variant="contained"
                        />
                      ) : (
                        <div className="session-timeline-loaded-presence">
                          {subagents.length ? (
                            <div className="subagent-timeline-summary" aria-label="子智能体任务">
                              {subagents.map(({ task, currentRun }) => (
                                <button key={task.id} type="button" onClick={() => onOpenSubagent(task.id)}>
                                  <Bot size={14} />
                                  <span>{task.displayName}</span>
                                  <small>{subagentStatusLabel(currentRun?.status ?? "interrupted")}</small>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {canonicalThreadView}
                        </div>
                      )}
                  </div>
                </div>
              }
              width={240}
            />
            </ThreadScrollLayout>
          </div>
          <AnimatePresence initial={false}>
            {threadSummary.shouldShowInline ? (
            <ThreadSummaryInlinePresence
              key="thread-summary-inline"
              reducedMotion={reduceMotion}
            >
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
            </ThreadSummaryInlinePresence>
            ) : null}
          </AnimatePresence>
        </main>
      </div>
    </section>
  );
}

function ComposerFooterPresence({
  children,
  reducedMotion,
}: {
  children: React.ReactNode;
  reducedMotion: boolean;
}): React.ReactNode {
  const isPresent = useIsPresent();

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1, y: 0 }}
      aria-hidden={!isPresent ? true : undefined}
      className="composer-lifecycle-presence"
      data-presence={isPresent ? "present" : "exiting"}
      exit={{
        opacity: 0,
        scale: 0.985,
        y: 4,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.985, y: 4 }}
      style={{ pointerEvents: isPresent ? undefined : "none" }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      {children}
    </motion.div>
  );
}

function ThreadSummaryInlinePresence({
  children,
  reducedMotion,
}: {
  children: React.ReactNode;
  reducedMotion: boolean;
}): React.ReactNode {
  const isPresent = useIsPresent();

  return (
    <motion.div
      animate={{ opacity: 1, x: 0 }}
      aria-hidden={!isPresent ? true : undefined}
      className="thread-summary-inline"
      data-presence={isPresent ? "present" : "exiting"}
      data-testid="thread-summary-inline"
      exit={{
        opacity: 0,
        x: 6,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, x: 6 }}
      style={{ pointerEvents: isPresent ? undefined : "none" }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      {children}
    </motion.div>
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
          data-theme-component="dropdown-surface"
          alignOffset={-4}
          className="popover-surface popover popover-sub-content popover-menu--grid"
          collisionPadding={6}
          sideOffset={4}
          style={buildPopoverSizingStyle({ width: "auto" })}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
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
