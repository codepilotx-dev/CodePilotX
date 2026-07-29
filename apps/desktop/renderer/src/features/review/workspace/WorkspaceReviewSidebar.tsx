import React from "react";
import { FileIcon } from "@codepilotx/material-icon-theme";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { VList } from "virtua";
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  Columns2,
  Ellipsis,
  Eye,
  ExternalLink,
  File,
  FileDiff,
  GitCommitHorizontal,
  GitFork,
  GitPullRequestArrow,
  MessageSquarePlus,
  Minus,
  Plus,
  RotateCcw,
  Rows2,
  Search,
  Type,
  Undo2,
  WrapText,
  createLucideIcon,
} from "lucide-react";
import type {
  DesktopDiffMarkerStyle,
  DesktopGitStatus,
  DesktopReviewComment,
  DesktopReviewDiffFile,
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
  DesktopReviewScope,
  DesktopReviewSource,
  DesktopReviewSide,
  DesktopReviewView,
  DesktopSessionStatus,
} from "../../../../shared/types.js";
import {
  desktopClient,
  WORKSPACE_GIT_CHANGED_EVENT,
} from "../../../services/desktop-client/index.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { Button } from "../../../components/ui/Button.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { buildPopoverSizingStyle } from "../../../components/ui/popoverSizing.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { ScrollArea } from "../../../components/ui/ScrollArea.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { buildReviewFileTree } from "./buildReviewFileTree.js";
import { buildCommentCountsByPath } from "../comments/reviewCommentUtils.js";
import { CommitPopover } from "./CommitPopover.js";
import { PullRequestPopover } from "./PullRequestPopover.js";
import { ReviewFileTreeNode } from "./ReviewFileTree.js";
import { formatReviewCount } from "../diff/reviewFormat.js";
import {
  isReviewDiffExpanded,
  toggleReviewDiffExpansion,
  type ReviewTabUiState,
} from "../../layout/tabs/conversationUiState.js";
import { syntaxTokenStyle } from "../../syntax/CodeBlock.js";
import { resolveLanguageFromPath } from "../../syntax/language.js";
import { resolveThemeId } from "../../syntax/theme.js";
import type { SyntaxToken } from "../../syntax/types.js";
import { useHighlightedCode } from "../../syntax/useHighlightedCode.js";
import { useDesktopTheme } from "../../theme/themeContext.js";
import {
  ReviewFileRequestCoordinator,
  reviewAgentClient,
  pickDefaultReviewBaseBranch,
  retainCurrentReviewFileDiffs,
  reviewLoadStateForError,
  reviewSourceKey,
  reviewSourceLabel,
  summaryFileToDesktop,
  type ReviewBranch,
  type ReviewCommit,
  type ReviewFileDiff,
  type ReviewLoadState,
  type ReviewSummarySnapshot,
} from "../source/reviewAgentClient.js";
import {
  createReviewCommentIdentity,
  createReviewSummaryIdentity,
  isReviewRequestCurrent,
  reviewGitChangeMatchesProject,
  ReviewRefreshCoordinator,
  type ReviewRequestStamp,
} from "../state/reviewRefreshCoordinator.js";
import {
  ListChevronsDownUp,
  ListChevronsUpDown,
  REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH,
  REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP,
  REVIEW_FILE_TREE_PANEL_MAX_WIDTH,
  REVIEW_FILE_TREE_PANEL_MIN_WIDTH,
  ReviewCommitSourceSubmenu,
  ReviewComment,
  ReviewDiffPreview,
  ReviewProjectEmptyState,
  attachComments,
  buildReviewComposerPrompt,
  clampReviewFileTreePanelWidth,
  copyGitApplyCommand,
  countReviewDiffLines,
  errorMessageOf,
  filterStatusForFile,
  formatPanelNumber,
  formatRelativeCommitTime,
  parseGithubPullRequestUrl,
  type CommentDraft,
  type ReviewFileLoadState,
  type ReviewFilter,
} from "../diff/WorkspaceReviewDiff.js";

const REVIEW_FILE_TREE_RUNTIME_MIN_WIDTH =
  REVIEW_FILE_TREE_PANEL_MIN_WIDTH + 8 + 260;

export type WorkspaceReviewSidebarProps = {
  activeSessionId: string | null;
  projectId: string | null;
  defaultBranch: string | null;
  gitStatus: DesktopGitStatus | null;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  isRefreshing: boolean;
  reviewView: DesktopReviewView;
  reviewTabState: ReviewTabUiState;
  sessionStatus: DesktopSessionStatus;
  workspacePath: string | null;
  onAppendComposerText?: (text: string) => void;
  onClose: () => void;
  onCreateBranch: () => void;
  onOpenWorkspacePath: () => void;
  onRefreshDiff: () => void;
  onReviewTabStateChange: (
    value:
      | ReviewTabUiState
      | ((current: ReviewTabUiState) => ReviewTabUiState),
  ) => void;
  onToggleReviewView: () => void;
};

function WorkspaceReviewSidebarImpl({
  activeSessionId,
  projectId,
  defaultBranch,
  gitStatus,
  isRefreshing,
  diffMarkerStyle,
  reviewView,
  reviewTabState,
  sessionStatus,
  workspacePath,
  onAppendComposerText,
  onClose,
  onCreateBranch,
  onOpenWorkspacePath,
  onRefreshDiff,
  onReviewTabStateChange,
  onToggleReviewView,
}: WorkspaceReviewSidebarProps): React.ReactNode {
  const source = reviewTabState.source;
  const summaryIdentity = createReviewSummaryIdentity(
    projectId,
    workspacePath,
    source,
  );
  const commentIdentity = createReviewCommentIdentity(
    summaryIdentity,
    activeSessionId,
  );
  const scope: DesktopReviewScope =
    source.kind === "staged" ? "staged" : "unstaged";
  const [reviewDiffState, setReviewDiff] = React.useState<Awaited<
    ReturnType<typeof desktopClient.getWorkspaceReviewDiff>
  > | null>(null);
  const [summaryState, setSummary] = React.useState<ReviewSummarySnapshot | null>(
    null,
  );
  const summaryStateIdentityRef = React.useRef(summaryIdentity);
  const summary =
    summaryStateIdentityRef.current === summaryIdentity ? summaryState : null;
  const reviewDiff =
    summaryStateIdentityRef.current === summaryIdentity ? reviewDiffState : null;
  const [loadedDiffs, setLoadedDiffs] = React.useState<
    ReadonlyMap<string, ReviewFileDiff>
  >(() => new Map());
  const [fileLoadStates, setFileLoadStates] = React.useState<
    ReadonlyMap<string, ReviewFileLoadState>
  >(() => new Map());
  const [branches, setBranches] = React.useState<ReviewBranch[]>([]);
  const [commits, setCommits] = React.useState<ReviewCommit[]>([]);
  const [sourceOptionsState, setSourceOptionsState] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [sourceOptionsRetry, setSourceOptionsRetry] = React.useState(0);
  const [commentsState, setComments] = React.useState<DesktopReviewComment[]>([]);
  const commentsStateIdentityRef = React.useRef(commentIdentity);
  const comments =
    commentsStateIdentityRef.current === commentIdentity ? commentsState : [];
  const selectedPath = reviewTabState.selectedFile;
  const setSelectedPath = React.useCallback(
    (value: string | null | ((current: string | null) => string | null)) => {
      onReviewTabStateChange((current) => ({
        ...current,
        selectedFile:
          typeof value === "function" ? value(current.selectedFile) : value,
      }));
    },
    [onReviewTabStateChange],
  );
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadState, setLoadState] =
    React.useState<ReviewLoadState>('loading');
  const [draft, setDraft] = React.useState<CommentDraft | null>(null);

  const [autoHideFileList, setAutoHideFileList] = React.useState(false);
  const hideFileList = !reviewTabState.fileTreeVisible || autoHideFileList;
  const setHideFileList = React.useCallback(
    (value: boolean | ((current: boolean) => boolean)) => {
      onReviewTabStateChange((current) => {
        const nextHidden =
          typeof value === "function" ? value(!current.fileTreeVisible) : value;
        return { ...current, fileTreeVisible: !nextHidden };
      });
    },
    [onReviewTabStateChange],
  );
  const fileTreePanelWidth = reviewTabState.fileTreeWidth;
  const setFileTreePanelWidth = React.useCallback(
    (value: number | ((current: number) => number)) => {
      onReviewTabStateChange((current) => ({
        ...current,
        fileTreeWidth:
          typeof value === "function" ? value(current.fileTreeWidth) : value,
      }));
    },
    [onReviewTabStateChange],
  );
  const [fileTreePanelResizing, setFileTreePanelResizing] =
    React.useState(false);
  const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [scopeMenuOpen, setScopeMenuOpen] = React.useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = React.useState(false);
  const [commitPopoverOpen, setCommitPopoverOpen] = React.useState(false);
  const [prPopoverOpen, setPrPopoverOpen] = React.useState(false);
  const [currentPullRequestUrl, setCurrentPullRequestUrl] = React.useState<
    string | null
  >(null);
  const [moreMenuOpen, setMoreMenuOpen] = React.useState(false);
  const wordWrap = reviewTabState.wrapLines;
  const richDiffPreview = reviewTabState.richPreview;
  const textDiff = reviewTabState.showWordDiff;
  const showWhitespace = !reviewTabState.hideWhitespace;
  const updateReviewBoolean = React.useCallback(
    (
      key: "wrapLines" | "richPreview" | "showWordDiff" | "hideWhitespace",
      value: boolean | ((current: boolean) => boolean),
    ) => {
      onReviewTabStateChange((current) => ({
        ...current,
        [key]:
          typeof value === "function"
            ? value(Boolean(current[key]))
            : value,
      }));
    },
    [onReviewTabStateChange],
  );
  const setWordWrap = React.useCallback(
    (value: boolean | ((current: boolean) => boolean)) =>
      updateReviewBoolean("wrapLines", value),
    [updateReviewBoolean],
  );
  const setRichDiffPreview = React.useCallback(
    (value: boolean | ((current: boolean) => boolean)) =>
      updateReviewBoolean("richPreview", value),
    [updateReviewBoolean],
  );
  const setTextDiff = React.useCallback(
    (value: boolean | ((current: boolean) => boolean)) =>
      updateReviewBoolean("showWordDiff", value),
    [updateReviewBoolean],
  );
  const setShowWhitespace = React.useCallback(
    (value: boolean | ((current: boolean) => boolean)) =>
      updateReviewBoolean("hideWhitespace", (current) =>
        typeof value === "function" ? !value(!current) : !value,
      ),
    [updateReviewBoolean],
  );
  const selectSource = React.useCallback(
    (nextSource: DesktopReviewSource) => {
      onReviewTabStateChange((current) => ({
        ...current,
        source: nextSource,
        selectedFile: null,
        selectedCommentId: null,
        scrollTop: 0,
        diffExpansion: { mode: "all" },
      }));
      setScopeMenuOpen(false);
    },
    [onReviewTabStateChange],
  );

  React.useEffect(() => {
    if ((!scopeMenuOpen && !branchPickerOpen) || !workspacePath) return;
    let active = true;
    setSourceOptionsState("loading");
    void Promise.all([
      reviewAgentClient.branches(workspacePath),
      reviewAgentClient.commits(workspacePath),
    ]).then(
      ([nextBranches, nextCommits]) => {
        if (!active) return;
        setBranches(nextBranches);
        setCommits(nextCommits);
        setSourceOptionsState("ready");
      },
      () => {
        if (active) setSourceOptionsState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [
    branchPickerOpen,
    scopeMenuOpen,
    sourceOptionsRetry,
    workspacePath,
  ]);

  const commitButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const prButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const reviewMainRef = React.useRef<HTMLDivElement | null>(null);
  const reviewRootRef = React.useRef<HTMLElement | null>(null);
  const staleGitChangeRef = React.useRef(false);
  const summaryRef = React.useRef<ReviewSummarySnapshot | null>(null);
  const summaryCacheStateRef = React.useRef<"fresh" | "stale" | null>(null);
  const loadedDiffsRef = React.useRef<
    ReadonlyMap<string, ReviewFileDiff>
  >(new Map());
  const loadedDiffOptionsRef = React.useRef(new Map<string, boolean>());
  const fileRequestCoordinatorRef = React.useRef(
    new ReviewFileRequestCoordinator(2),
  );
  const fileRequestIdRef = React.useRef(0);
  const activeFileRequestRef = React.useRef(
    new Map<string, ReviewRequestStamp>(),
  );
  const expiredFilePathsRef = React.useRef(new Set<string>());
  const refreshCoordinatorRef = React.useRef(
    new ReviewRefreshCoordinator<{
      snapshot: ReviewSummarySnapshot;
      cacheState: "fresh" | "stale";
    }>(),
  );
  const activeSummaryIdentityRef = React.useRef(summaryIdentity);
  const activeCommentIdentityRef = React.useRef(commentIdentity);
  activeSummaryIdentityRef.current = summaryIdentity;
  activeCommentIdentityRef.current = commentIdentity;
  const diffScrollViewportRef = React.useRef<HTMLDivElement | null>(null);
  const diffFileSectionRefs = React.useRef(new Map<string, HTMLElement>());
  const fileSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const errorTimerRef = React.useRef<number | null>(null);
  const publishedGithubCommentIdsRef = React.useRef(new Set<string>());
  const mutationRequestTokenRef = React.useRef(0);
  const pendingScrollTopRef = React.useRef<number | null>(null);
  const pendingScrollIdentityRef = React.useRef<string | null>(null);
  const scrollPersistTimerRef = React.useRef<number | null>(null);
  const onReviewTabStateChangeRef = React.useRef(onReviewTabStateChange);
  onReviewTabStateChangeRef.current = onReviewTabStateChange;
  const fileTreePanelResizeCleanupRef = React.useRef<(() => void) | null>(null);
  const resizeFrameRef = React.useRef<number | null>(null);
  const fileTreeResizePreviewRef = React.useRef<HTMLDivElement | null>(null);

  const flushReviewScroll = React.useCallback((identity: string): void => {
    if (scrollPersistTimerRef.current !== null) {
      window.clearTimeout(scrollPersistTimerRef.current);
      scrollPersistTimerRef.current = null;
    }
    const scrollTop = pendingScrollTopRef.current;
    const pendingIdentity = pendingScrollIdentityRef.current;
    pendingScrollTopRef.current = null;
    pendingScrollIdentityRef.current = null;
    if (
      scrollTop === null ||
      pendingIdentity !== identity ||
      activeSummaryIdentityRef.current !== identity
    ) {
      return;
    }
    const sourceKey = reviewSourceKey(source);
    onReviewTabStateChangeRef.current((current) =>
      reviewSourceKey(current.source) === sourceKey
        ? { ...current, scrollTop }
        : current,
    );
  }, [source]);

  const handleReviewScroll = React.useCallback(
    (scrollTop: number): void => {
      const identity = summaryIdentity;
      pendingScrollTopRef.current = scrollTop;
      pendingScrollIdentityRef.current = identity;
      if (scrollPersistTimerRef.current !== null) {
        window.clearTimeout(scrollPersistTimerRef.current);
      }
      scrollPersistTimerRef.current = window.setTimeout(
        () => flushReviewScroll(identity),
        150,
      );
    },
    [flushReviewScroll, summaryIdentity],
  );
  const flushReviewScrollRef = React.useRef(flushReviewScroll);
  flushReviewScrollRef.current = flushReviewScroll;

  const refreshReviewDiff = React.useCallback((force = false) => {
    const identity = summaryIdentity;
    const request = refreshCoordinatorRef.current.request(
      identity,
      force,
      async (refresh): Promise<{
        snapshot: ReviewSummarySnapshot;
        cacheState: "fresh" | "stale";
      } | null> => {
        if (!workspacePath) {
          if (activeSummaryIdentityRef.current !== identity) return null;
          summaryStateIdentityRef.current = identity;
          summaryRef.current = null;
          summaryCacheStateRef.current = null;
          loadedDiffsRef.current = new Map();
          setSummary(null);
          setLoadedDiffs(new Map());
          setFileLoadStates(new Map());
          setReviewDiff(null);
          setLoadState('not-repository');
          return null;
        }
        try {
          if (activeSummaryIdentityRef.current !== identity) return null;
          setLoadState(current =>
            summaryRef.current !== null ||
            current === 'success' ||
            current === 'empty' ||
            current === 'large-diff'
              ? 'stale'
              : 'loading',
          );
          setError(null);
          const result = await reviewAgentClient.summary(
            workspacePath,
            source,
            refresh,
          );
          if (activeSummaryIdentityRef.current !== identity) return null;
          const nextSummary = result.snapshot;
          summaryCacheStateRef.current = result.cacheState;
          const retainedDiffs = retainCurrentReviewFileDiffs(
            nextSummary,
            loadedDiffsRef.current,
          );
          const retainedPaths = new Set(retainedDiffs.keys());
          for (const path of loadedDiffOptionsRef.current.keys()) {
            if (!retainedPaths.has(path)) {
              loadedDiffOptionsRef.current.delete(path);
            }
          }
          summaryRef.current = nextSummary;
          loadedDiffsRef.current = retainedDiffs;
          summaryStateIdentityRef.current = identity;
          setSummary(nextSummary);
          setLoadedDiffs(retainedDiffs);
          const expiredPaths =
            result.cacheState === "fresh"
              ? new Set(expiredFilePathsRef.current)
              : new Set<string>();
          if (result.cacheState === "fresh") {
            expiredFilePathsRef.current.clear();
          }
          setFileLoadStates((current) => {
            const next = new Map<string, ReviewFileLoadState>();
            for (const file of nextSummary.files) {
              if (retainedPaths.has(file.path)) {
                next.set(file.path, { status: "loaded" });
                continue;
              }
              const previous = current.get(file.path);
              if (
                previous?.status === "error" &&
                !expiredPaths.has(file.path)
              ) {
                next.set(file.path, previous);
              }
            }
            return next;
          });
          setReviewDiff({
            activeScope: scope,
            scopes: [
              {
                scope: "unstaged",
                changedFiles:
                  source.kind === "unstaged" ? nextSummary.totals.files : 0,
                additions:
                  source.kind === "unstaged" ? nextSummary.totals.additions : 0,
                deletions:
                  source.kind === "unstaged" ? nextSummary.totals.deletions : 0,
              },
              {
                scope: "staged",
                changedFiles:
                  source.kind === "staged" ? nextSummary.totals.files : 0,
                additions:
                  source.kind === "staged" ? nextSummary.totals.additions : 0,
                deletions:
                  source.kind === "staged" ? nextSummary.totals.deletions : 0,
              },
            ],
            files: nextSummary.files.map((file) =>
              summaryFileToDesktop(file, retainedDiffs.get(file.path)),
            ),
            status:
              gitStatus ?? {
                branchName: null,
                upstream: null,
                ahead: 0,
                behind: 0,
                clean: nextSummary.files.length === 0,
                files: [],
              },
          });
          setLoadState(
            result.cacheState === 'stale'
              ? 'stale'
              : nextSummary.largeDiffMode
              ? 'large-diff'
              : nextSummary.files.length === 0
                ? 'empty'
                : 'success',
          );
          return result;
        } catch (refreshError) {
          if (activeSummaryIdentityRef.current !== identity) return null;
          if (summaryRef.current !== null) summaryCacheStateRef.current = "stale";
          setFileLoadStates((current) => {
            const next = new Map(current);
            for (const [path, state] of next) {
              if (state.status === "loading") next.delete(path);
            }
            return next;
          });
          setLoadState(reviewLoadStateForError(refreshError));
          setError(errorMessageOf(refreshError));
          return null;
        }
      },
    );
    return request.catch((refreshError: unknown) => {
      if (activeSummaryIdentityRef.current === identity) {
        if (summaryRef.current !== null) summaryCacheStateRef.current = "stale";
        setFileLoadStates((current) => {
          const next = new Map(current);
          for (const [path, state] of next) {
            if (state.status === "loading") next.delete(path);
          }
          return next;
        });
        setLoadState(reviewLoadStateForError(refreshError));
        setError(errorMessageOf(refreshError));
      }
      return null;
    });
  }, [gitStatus, scope, source, summaryIdentity, workspacePath]);

  const recoverExpiredReview = React.useCallback(
    async (
      recoveryError: unknown,
      identity: string,
    ): Promise<{
      snapshot: ReviewSummarySnapshot;
      cacheState: "fresh";
    } | null> => {
      if (!reviewAgentClient.isSnapshotExpired(recoveryError)) return null;
      const refreshed = await refreshReviewDiff(true);
      if (
        activeSummaryIdentityRef.current !== identity ||
        refreshed?.cacheState !== "fresh"
      ) {
        return null;
      }
      setError(null);
      return {
        snapshot: refreshed.snapshot,
        cacheState: "fresh",
      };
    },
    [refreshReviewDiff],
  );

  React.useEffect(() => {
    refreshCoordinatorRef.current.invalidate();
    fileRequestCoordinatorRef.current = new ReviewFileRequestCoordinator(2);
    summaryRef.current = null;
    summaryCacheStateRef.current = null;
    loadedDiffsRef.current = new Map();
    loadedDiffOptionsRef.current.clear();
    activeFileRequestRef.current.clear();
    expiredFilePathsRef.current.clear();
    mutationRequestTokenRef.current += 1;
    summaryStateIdentityRef.current = summaryIdentity;
    setSummary(null);
    setLoadedDiffs(new Map());
    setFileLoadStates(new Map());
    setReviewDiff(null);
    setError(null);
    setPending(false);
    setCurrentPullRequestUrl(null);
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, [summaryIdentity]);

  React.useEffect(() => {
    commentsStateIdentityRef.current = commentIdentity;
    setComments([]);
    setDraft(null);
    publishedGithubCommentIdsRef.current.clear();
  }, [commentIdentity]);

  const loadFileDiff = React.useCallback(
    async (
      path: string,
      priority: "selected" | "prefetch" = "prefetch",
      retryExpired = true,
    ): Promise<void> => {
      const identity = summaryIdentity;
      if (activeSummaryIdentityRef.current !== identity) return;
      const currentSummary = summaryRef.current;
      if (
        !workspacePath ||
        !currentSummary ||
        summaryCacheStateRef.current !== "fresh"
      ) {
        return;
      }
      if (
        loadedDiffsRef.current.has(path) &&
        loadedDiffOptionsRef.current.get(path) === reviewTabState.hideWhitespace
      ) {
        return;
      }
      const fileSummary = currentSummary.files.find((file) => file.path === path);
      if (!fileSummary) return;
      const requestKey = [
        currentSummary.generation,
        path,
        reviewTabState.hideWhitespace ? "hide-whitespace" : "standard",
      ].join("\0");
      setFileLoadStates((current) => {
        if (current.get(path)?.status === "loading") return current;
        return new Map(current).set(path, { status: "loading" });
      });
      const beginRequest = (generation: string): ReviewRequestStamp => {
        const request = {
          identity,
          generation,
          requestId: ++fileRequestIdRef.current,
        };
        activeFileRequestRef.current.set(path, request);
        return request;
      };
      const requestIsCurrent = (request: ReviewRequestStamp): boolean => {
        const latestSummary = summaryRef.current;
        return (
          activeSummaryIdentityRef.current === identity &&
          summaryCacheStateRef.current === "fresh" &&
          latestSummary?.generation === request.generation &&
          isReviewRequestCurrent(
            request,
            activeFileRequestRef.current.get(path),
          )
        );
      };
      const failLoad = (
        request: ReviewRequestStamp,
        loadError: unknown,
        publishSharedError = true,
      ): void => {
        if (!requestIsCurrent(request)) return;
        const message = errorMessageOf(loadError);
        if (publishSharedError) setError(message);
        setFileLoadStates((current) =>
          new Map(current).set(path, { status: "error", message }),
        );
      };
      const commitLoaded = (
        request: ReviewRequestStamp,
        loaded: ReviewFileDiff,
        expectedSummary: ReviewSummarySnapshot,
      ): void => {
        if (!requestIsCurrent(request)) return;
        const latestSummary = summaryRef.current;
        if (
          !latestSummary ||
          latestSummary.generation !== expectedSummary.generation
        ) {
          return;
        }
        const currentFile = latestSummary.files.find(
          (file) => file.path === path,
        );
        if (!currentFile || currentFile.revision !== loaded.revision) return;
        const nextLoadedDiffs = new Map(loadedDiffsRef.current).set(path, loaded);
        loadedDiffsRef.current = nextLoadedDiffs;
        loadedDiffOptionsRef.current.set(
          path,
          reviewTabState.hideWhitespace,
        );
        expiredFilePathsRef.current.delete(path);
        setLoadedDiffs(nextLoadedDiffs);
        setFileLoadStates((current) =>
          new Map(current).set(path, { status: "loaded" }),
        );
        setReviewDiff((current) =>
          current
            ? {
                ...current,
                files: current.files.map((file) =>
                  file.path === path
                    ? summaryFileToDesktop(currentFile, loaded)
                    : file,
                ),
              }
            : current,
        );
        onReviewTabStateChange((current) => ({
          ...current,
          viewedRevisions: {
            ...current.viewedRevisions,
            [path]: loaded.revision,
          },
        }));
      };
      return fileRequestCoordinatorRef.current.schedule(
        requestKey,
        async () => {
          if (activeSummaryIdentityRef.current !== identity) return;
          let request = beginRequest(currentSummary.generation);
          try {
            const loaded = await reviewAgentClient.fileDiff(
              workspacePath,
              source,
              currentSummary.generation,
              path,
              reviewTabState.hideWhitespace,
            );
            commitLoaded(request, loaded, currentSummary);
          } catch (loadError) {
            if (
              retryExpired &&
              reviewAgentClient.isSnapshotExpired(loadError)
            ) {
              expiredFilePathsRef.current.add(path);
              try {
                const refreshed = await recoverExpiredReview(loadError, identity);
                if (
                  !refreshed ||
                  activeSummaryIdentityRef.current !== identity
                ) {
                  failLoad(request, loadError, false);
                  return;
                }
                const refreshedFile = refreshed.snapshot.files.find(
                  file => file.path === path,
                );
                if (!refreshedFile) {
                  request = beginRequest(refreshed.snapshot.generation);
                  failLoad(request, new Error("刷新后找不到该文件差异"));
                  return;
                }
                request = beginRequest(refreshed.snapshot.generation);
                const loaded = await reviewAgentClient.fileDiff(
                  workspacePath,
                  source,
                  refreshed.snapshot.generation,
                  path,
                  reviewTabState.hideWhitespace,
                );
                commitLoaded(request, loaded, refreshed.snapshot);
              } catch (retryError) {
                if (reviewAgentClient.isSnapshotExpired(retryError)) {
                  expiredFilePathsRef.current.add(path);
                }
                failLoad(request, retryError);
              }
              return;
            }
            failLoad(request, loadError);
          }
        },
        priority,
      );
    },
    [
      onReviewTabStateChange,
      recoverExpiredReview,
      reviewTabState.hideWhitespace,
      source,
      summaryIdentity,
      workspacePath,
    ],
  );

  const refreshComments = React.useCallback(async () => {
    const identity = commentIdentity;
    if (!activeSessionId) {
      if (activeCommentIdentityRef.current === identity) setComments([]);
      return;
    }
    try {
      if (!workspacePath) {
        if (activeCommentIdentityRef.current === identity) setComments([]);
        return;
      }
      const nextComments = await reviewAgentClient.listComments(
        workspacePath,
        activeSessionId,
        source,
      );
      if (activeCommentIdentityRef.current === identity) {
        commentsStateIdentityRef.current = identity;
        setComments(nextComments);
      }
    } catch (refreshError) {
      if (activeCommentIdentityRef.current === identity) {
        setError(errorMessageOf(refreshError));
      }
    }
  }, [activeSessionId, commentIdentity, source, workspacePath]);

  React.useEffect(() => {
    void refreshReviewDiff();
  }, [refreshReviewDiff, isRefreshing]);

  React.useEffect(() => {
    const handleGitChange = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (!reviewGitChangeMatchesProject(detail, projectId)) return;
      if (reviewRootRef.current?.offsetParent !== null) {
        void refreshReviewDiff(true);
        return;
      }
      staleGitChangeRef.current = true;
    };
    window.addEventListener(WORKSPACE_GIT_CHANGED_EVENT, handleGitChange);
    return () =>
      window.removeEventListener(WORKSPACE_GIT_CHANGED_EVENT, handleGitChange);
  }, [projectId, refreshReviewDiff]);

  React.useEffect(() => {
    const root = reviewRootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        staleGitChangeRef.current
      ) {
        staleGitChangeRef.current = false;
        void refreshReviewDiff(true);
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [refreshReviewDiff]);

  React.useEffect(() => {
    void refreshComments();
  }, [refreshComments]);

  React.useEffect(() => {
    const files = reviewDiff?.files ?? [];
    if (files.length === 0) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath((current) =>
      current && files.some((file) => file.path === current)
        ? current
        : (files[0]?.path ?? null),
    );
  }, [reviewDiff]);

  React.useEffect(() => {
    if (selectedPath) void loadFileDiff(selectedPath, "selected");
  }, [loadFileDiff, selectedPath]);

  React.useEffect(() => {
    if (!summary) return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = diffScrollViewportRef.current;
      if (viewport) viewport.scrollTop = reviewTabState.scrollTop;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [summary?.generation]);

  React.useEffect(() => {
    const main = reviewMainRef.current;
    if (!main || typeof ResizeObserver === "undefined") return;
    const updateAutoHide = (width: number): void => {
      const shouldHide =
        width > 0 && width < REVIEW_FILE_TREE_RUNTIME_MIN_WIDTH;
      setAutoHideFileList((current) =>
        current === shouldHide ? current : shouldHide,
      );
    };
    updateAutoHide(main.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateAutoHide(entry.contentRect.width);
    });
    observer.observe(main);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const identity = summaryIdentity;
    return () => flushReviewScroll(identity);
  }, [flushReviewScroll, summaryIdentity]);

  React.useEffect(() => {
    return () => {
      refreshCoordinatorRef.current.dispose();
      flushReviewScrollRef.current(activeSummaryIdentityRef.current);
      if (errorTimerRef.current !== null) {
        window.clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
      if (scrollPersistTimerRef.current !== null) {
        window.clearTimeout(scrollPersistTimerRef.current);
        scrollPersistTimerRef.current = null;
      }
      fileTreePanelResizeCleanupRef.current?.();
    };
  }, []);

  function flashError(message: string): void {
    setError(message);
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
    }
    errorTimerRef.current = window.setTimeout(() => {
      setError(null);
      errorTimerRef.current = null;
    }, 3000);
  }

  function isMutationCurrent(
    token: number,
    expectedSummaryIdentity: string,
    expectedCommentIdentity?: string,
  ): boolean {
    return (
      mutationRequestTokenRef.current === token &&
      activeSummaryIdentityRef.current === expectedSummaryIdentity &&
      (expectedCommentIdentity === undefined ||
        activeCommentIdentityRef.current === expectedCommentIdentity)
    );
  }

  const files = reviewDiff?.files ?? [];
  const reviewMutationPending =
    pending || summaryCacheStateRef.current !== "fresh";
  const allFilePaths = React.useMemo(
    () => files.map((file) => file.path),
    [files],
  );
  const collapsedDiffPaths = React.useMemo(() => {
    return new Set(
      allFilePaths.filter(
        (path) =>
          !isReviewDiffExpanded(reviewTabState.diffExpansion, path),
      ),
    );
  }, [allFilePaths, reviewTabState.diffExpansion]);
  const showProjectEmptyState =
    loadState === "empty" && summary !== null && files.length === 0;
  const visibleFiles = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.filter((file) => {
      if (query && !file.path.toLowerCase().includes(query)) return false;
      if (filter === "all") return true;
      return filterStatusForFile(file) === filter;
    });
  }, [files, filter, search]);

  React.useEffect(() => {
    if (
      !selectedPath ||
      visibleFiles.some((file) => file.path === selectedPath)
    ) {
      return;
    }
    setSelectedPath(visibleFiles[0]?.path ?? null);
  }, [selectedPath, visibleFiles]);

  const reviewTree = React.useMemo(
    () => buildReviewFileTree(visibleFiles),
    [visibleFiles],
  );

  React.useEffect(() => {
    if (!selectedPath) return;
    const segments = selectedPath.split("/").slice(0, -1);
    if (segments.length === 0) return;
    setCollapsedDirs((prev) => {
      let next: Set<string> | null = null;
      let path = "";
      for (const segment of segments) {
        path = path ? `${path}/${segment}` : segment;
        if (prev.has(path)) {
          if (!next) next = new Set(prev);
          next.delete(path);
        }
      }
      return next ?? prev;
    });
  }, [selectedPath]);

  const selectedFile =
    visibleFiles.find((file) => file.path === selectedPath) ??
    visibleFiles[0] ??
    null;
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
  const largeDiffMode =
    summary?.largeDiffMode === true ||
    countReviewDiffLines(visibleFiles) > 800;
  const allCollapsed =
    files.length > 0 &&
    files.every((file) => collapsedDiffPaths.has(file.path));
  const { attachedComments, staleComments } = React.useMemo(
    () => attachComments(files, comments),
    [comments, files],
  );
  const openComments = comments.filter((comment) => comment.status === "open");
  const commentCountsByPath = React.useMemo(
    () => buildCommentCountsByPath(openComments),
    [openComments],
  );
  const sessionBusy =
    sessionStatus === "running" || sessionStatus === "waiting";

  function toggleDir(dirPath: string): void {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }

  function toggleCollapseDiff(path: string): void {
    const willExpand = collapsedDiffPaths.has(path);
    onReviewTabStateChange((current) => ({
      ...current,
      selectedFile: willExpand ? path : current.selectedFile,
      diffExpansion: toggleReviewDiffExpansion(
        current.diffExpansion,
        allFilePaths,
        path,
      ),
    }));
    if (willExpand) void loadFileDiff(path, "selected");
  }

  function collapseAllDiffs(): void {
    onReviewTabStateChange((current) => ({
      ...current,
      diffExpansion: { mode: "none" },
    }));
  }

  function expandAllDiffs(): void {
    onReviewTabStateChange((current) => ({
      ...current,
      diffExpansion: { mode: "all" },
    }));
  }

  async function applyOperation(
    action: "stage" | "unstage" | "revert",
    target:
      | { type: "file"; path: string }
      | { type: "hunk"; path: string; hunkId: string },
  ): Promise<void> {
    if (!workspacePath || !summary || pending) return;
    if (summaryCacheStateRef.current !== "fresh") {
      void refreshReviewDiff(true);
      return;
    }
    if (source.kind !== "unstaged" && source.kind !== "staged") {
      flashError("分支、提交、上轮对话和 PR 差异为只读来源");
      return;
    }
    if (
      action === "revert" &&
      !window.confirm(`确定要丢弃 ${target.path} 的所选变更吗？此操作无法撤销。`)
    ) {
      return;
    }
    const file = summary.files.find((candidate) => candidate.path === target.path);
    if (!file) return;
    const operationIdentity = summaryIdentity;
    const operationToken = ++mutationRequestTokenRef.current;
    setPending(true);
    try {
      await reviewAgentClient.apply(workspacePath, {
        source,
        generation: summary.generation,
        expectedRevision: file.revision,
        action,
        target:
          target.type === "file"
            ? { kind: "file", path: target.path }
            : {
                kind: "hunk",
                path: target.path,
                hunkId: target.hunkId,
              },
      });
      if (!isMutationCurrent(operationToken, operationIdentity)) return;
      setError(null);
      await refreshReviewDiff(true);
      if (isMutationCurrent(operationToken, operationIdentity)) {
        onRefreshDiff();
      }
    } catch (operationError) {
      if (isMutationCurrent(operationToken, operationIdentity)) {
        if (reviewAgentClient.isSnapshotExpired(operationError)) {
          await recoverExpiredReview(operationError, operationIdentity);
        } else {
          setError(errorMessageOf(operationError));
        }
      }
    } finally {
      if (isMutationCurrent(operationToken, operationIdentity)) {
        setPending(false);
      }
    }
  }

  async function saveDraft(): Promise<void> {
    if (
      !activeSessionId ||
      !workspacePath ||
      !summary ||
      !draft ||
      !draft.body.trim()
    ) {
      return;
    }
    const file = summary.files.find(
      (candidate) => candidate.path === draft.filePath,
    );
    if (!file) return;
    const operationIdentity = summaryIdentity;
    const operationToken = ++mutationRequestTokenRef.current;
    setPending(true);
    try {
      const saved = await reviewAgentClient.saveComment(
        workspacePath,
        activeSessionId,
        source,
        file.revision,
        {
          filePath: draft.filePath,
          side: draft.side,
          lineNumber: draft.lineNumber,
          body: draft.body.trim(),
        },
      );
      if (
        !isMutationCurrent(
          operationToken,
          operationIdentity,
          commentIdentity,
        )
      ) return;
      setComments((current) => [
        ...current.filter((comment) => comment.id !== saved.id),
        saved,
      ]);
      setDraft(null);
    } catch (commentError) {
      if (
        isMutationCurrent(operationToken, operationIdentity, commentIdentity)
      ) {
        setError(errorMessageOf(commentError));
      }
    } finally {
      if (
        isMutationCurrent(operationToken, operationIdentity, commentIdentity)
      ) {
        setPending(false);
      }
    }
  }

  async function resolveComment(commentId: string): Promise<void> {
    if (!activeSessionId || !workspacePath) return;
    const identity = commentIdentity;
    const resolved = await reviewAgentClient.resolveComment(
      workspacePath,
      activeSessionId,
      commentId,
    );
    if (activeCommentIdentityRef.current !== identity) return;
    setComments((current) =>
      current.map((comment) =>
        comment.id === resolved.id ? resolved : comment,
      ),
    );
  }

  async function deleteComment(commentId: string): Promise<void> {
    if (!activeSessionId || !workspacePath) return;
    const identity = commentIdentity;
    await reviewAgentClient.deleteComment(
      workspacePath,
      activeSessionId,
      commentId,
    );
    if (activeCommentIdentityRef.current !== identity) return;
    setComments((current) =>
      current.filter((comment) => comment.id !== commentId),
    );
  }

  async function sendCommentsToAgent(): Promise<void> {
    if (!activeSessionId || sessionBusy || openComments.length === 0) return;
    const body = [
      "请按这些本地行内审查评论修改代码：",
      "",
      ...openComments.map(
        (comment, index) =>
          `${index + 1}. ${comment.filePath}:${comment.lineNumber} (${comment.side})\n` +
          `   行内容：${comment.lineContent || "(空行)"}\n` +
          `   评论：${comment.body}`,
      ),
    ].join("\n");
    await desktopClient.sendUserMessage(activeSessionId, { text: body });
  }

  async function submitGithubReview(
    event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
  ): Promise<void> {
    if (source.kind !== "pull-request" || pending) return;
    const expectedHeadRevision = summary?.headSha;
    if (!expectedHeadRevision) {
      flashError("当前 PR 缺少 head revision，请刷新审阅后重试");
      return;
    }
    if (event !== "APPROVE" && openComments.length === 0) {
      flashError("请先添加至少一条行内评论");
      return;
    }
    const reviewSource = source;
    const reviewComments = [...openComments];
    const operationSummaryIdentity = summaryIdentity;
    const operationCommentIdentity = commentIdentity;
    const operationToken = ++mutationRequestTokenRef.current;
    setPending(true);
    try {
      for (const comment of reviewComments) {
        if (
          !isMutationCurrent(
            operationToken,
            operationSummaryIdentity,
            operationCommentIdentity,
          )
        ) {
          return;
        }
        if (
          comment.githubCommentId ||
          publishedGithubCommentIdsRef.current.has(comment.id)
        ) {
          continue;
        }
        const published = await reviewAgentClient.publishGithubComment(reviewSource, {
          body: comment.body,
          path: comment.filePath,
          side: comment.side,
          line: comment.lineNumber,
          expectedHeadRevision,
          commitId: expectedHeadRevision,
        });
        if (
          !isMutationCurrent(
            operationToken,
            operationSummaryIdentity,
            operationCommentIdentity,
          )
        ) {
          return;
        }
        publishedGithubCommentIdsRef.current.add(comment.id);
        if (workspacePath) {
          const linked = await reviewAgentClient.linkGithubComment(
            workspacePath,
            reviewSource,
            comment,
            published,
          );
          if (
            !isMutationCurrent(
              operationToken,
              operationSummaryIdentity,
              operationCommentIdentity,
            )
          ) {
            return;
          }
          setComments((current) =>
            current.map((candidate) =>
              candidate.id === linked.id ? linked : candidate,
            ),
          );
        }
      }
      await reviewAgentClient.submitGithubReview(
        reviewSource,
        event,
        expectedHeadRevision,
        event === "APPROVE"
          ? undefined
          : `CodePilotX 提交了 ${reviewComments.length} 条行内审阅评论。`,
      );
      if (
        isMutationCurrent(
          operationToken,
          operationSummaryIdentity,
          operationCommentIdentity,
        )
      ) {
        setError(null);
      }
    } catch (reviewError) {
      if (
        isMutationCurrent(
          operationToken,
          operationSummaryIdentity,
          operationCommentIdentity,
        )
      ) {
        setError(errorMessageOf(reviewError));
      }
    } finally {
      if (
        isMutationCurrent(
          operationToken,
          operationSummaryIdentity,
          operationCommentIdentity,
        )
      ) {
        setPending(false);
      }
    }
  }

  function sendReviewPromptToComposer(): void {
    if (!onAppendComposerText) return;
    onAppendComposerText(
      buildReviewComposerPrompt(
        reviewDiff?.status ?? gitStatus,
        reviewDiff?.files ?? [],
      ),
    );
  }

  async function handleCommit(
    message: string,
    includeUnstaged: boolean,
  ): Promise<boolean> {
    if (!workspacePath || pending) return false;
    if (!message.trim()) {
      flashError("请输入提交信息");
      return false;
    }
    const operationIdentity = summaryIdentity;
    const operationToken = ++mutationRequestTokenRef.current;
    setPending(true);
    try {
      let commitPaths: string[] = [];
      if (includeUnstaged) {
        const statusResult =
          await desktopClient.getWorkspaceGitStatus(workspacePath);
        if ("error" in statusResult) {
          throw new Error(statusResult.error);
        }
        commitPaths = [
          ...new Set(statusResult.status.files.map((file) => file.path)),
        ];
      }
      const result = await desktopClient.commitWorkspaceChanges({
        workspacePath,
        message: message.trim(),
        paths: commitPaths,
      });
      if (result.ok === false) throw new Error(result.error);
      if (
        activeSummaryIdentityRef.current !== operationIdentity ||
        mutationRequestTokenRef.current !== operationToken
      ) {
        return false;
      }
      setCommitPopoverOpen(false);
      await refreshReviewDiff(true);
      if (
        activeSummaryIdentityRef.current !== operationIdentity ||
        mutationRequestTokenRef.current !== operationToken
      ) {
        return false;
      }
      onRefreshDiff();
      return true;
    } catch (commitError) {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setError(errorMessageOf(commitError));
      }
      return false;
    } finally {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setPending(false);
      }
    }
  }

  async function handleCommitAndPush(
    message: string,
    includeUnstaged: boolean,
  ): Promise<void> {
    if (!workspacePath || pending) return;
    const committed = await handleCommit(message, includeUnstaged);
    if (!committed) return;
    await handlePush();
  }

  async function handlePush(): Promise<void> {
    if (!workspacePath || pending) return;
    const operationIdentity = summaryIdentity;
    const operationToken = ++mutationRequestTokenRef.current;
    setPending(true);
    try {
      const result = await desktopClient.pushWorkspaceBranch({
        workspacePath,
        setUpstream: !gitStatus?.upstream,
      });
      if (result.ok === false) throw new Error(result.error);
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setCommitPopoverOpen(false);
        onRefreshDiff();
      }
    } catch (pushError) {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setError(errorMessageOf(pushError));
      }
    } finally {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setPending(false);
      }
    }
  }

  async function createPullRequest(
    title: string,
    body: string,
    pushFirst: boolean,
    draft: boolean,
  ): Promise<void> {
    if (!workspacePath || pending) return;
    if (!title.trim()) {
      flashError("请输入 Pull Request 标题");
      return;
    }
    const operationIdentity = summaryIdentity;
    const operationToken = ++mutationRequestTokenRef.current;
    setPending(true);
    try {
      if (pushFirst) {
        const pushed = await desktopClient.pushWorkspaceBranch({
          workspacePath,
          setUpstream: !gitStatus?.upstream,
        });
        if (pushed.ok === false) throw new Error(pushed.error);
      }
      const result = await desktopClient.createPullRequest({
        workspacePath,
        title: title.trim(),
        body: body.trim(),
        draft,
      });
      if (result.ok === false) throw new Error(result.error);
      if (
        activeSummaryIdentityRef.current !== operationIdentity ||
        mutationRequestTokenRef.current !== operationToken
      ) {
        return;
      }
      setCurrentPullRequestUrl(result.url);
      const identity = parseGithubPullRequestUrl(result.url);
      if (identity) {
        selectSource({ kind: "pull-request", ...identity });
      }
      setPrPopoverOpen(false);
    } catch (pullRequestError) {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setError(errorMessageOf(pullRequestError));
      }
    } finally {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setPending(false);
      }
    }
  }

  function handleCreatePR(
    title: string,
    body: string,
    pushFirst: boolean,
  ): void {
    void createPullRequest(title, body, pushFirst, false);
  }

  function handleCreateDraftPR(
    title: string,
    body: string,
    pushFirst: boolean,
  ): void {
    void createPullRequest(title, body, pushFirst, true);
  }

  function handleOpenPR(): void {
    setPrPopoverOpen(false);
    const url =
      currentPullRequestUrl ??
      (source.kind === "pull-request"
        ? `https://github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/pull/${source.number}`
        : null);
    if (!url) {
      flashError("当前还没有可打开的 Pull Request");
      return;
    }
    void desktopClient.openExternalURL(url).catch((openError) => {
      setError(errorMessageOf(openError));
    });
  }

  async function handleLastTurnScope(): Promise<void> {
    if (!activeSessionId) return;
    setScopeMenuOpen(false);
    try {
      const snapshot = await desktopClient.getSession(activeSessionId);
      const event = [...(snapshot.events ?? [])]
        .reverse()
        .find(
          (candidate) =>
            "turnId" in candidate &&
            typeof candidate.turnId === "string" &&
            candidate.type !== "turn.started",
        );
      if (!event || !("turnId" in event)) {
        flashError("当前任务还没有可审阅的上一轮变更");
        return;
      }
      selectSource({
        kind: "last-turn",
        threadId: activeSessionId,
        turnId: event.turnId,
      });
    } catch (lastTurnError) {
      flashError(errorMessageOf(lastTurnError));
    }
  }

  async function applyAll(
    action: "stage" | "unstage" | "revert",
  ): Promise<void> {
    if (
      !workspacePath ||
      pending ||
      (source.kind !== "unstaged" && source.kind !== "staged")
    ) {
      return;
    }
    const currentSummary = summary;
    const itemList =
      currentSummary?.files.map((file) => ({
        path: file.path,
        expectedRevision: file.revision,
      })) ?? [];
    const firstItem = itemList[0];
    if (!currentSummary || !firstItem) return;
    if (summaryCacheStateRef.current !== "fresh") {
      void refreshReviewDiff(true);
      return;
    }
    const items: [
      { path: string; expectedRevision: string },
      ...Array<{ path: string; expectedRevision: string }>,
    ] = [firstItem, ...itemList.slice(1)];
    if (
      action === "revert" &&
      !window.confirm(`确定要丢弃全部 ${items.length} 个文件的变更吗？此操作无法撤销。`)
    ) {
      return;
    }
    const operationIdentity = summaryIdentity;
    const operationToken = ++mutationRequestTokenRef.current;
    setPending(true);
    try {
      await reviewAgentClient.applyBatch(workspacePath, {
        source,
        generation: currentSummary.generation,
        action,
        items,
      });
      if (
        activeSummaryIdentityRef.current !== operationIdentity ||
        mutationRequestTokenRef.current !== operationToken
      ) {
        return;
      }
      await refreshReviewDiff(true);
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setError(null);
        onRefreshDiff();
      }
    } catch (operationError) {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        if (reviewAgentClient.isSnapshotExpired(operationError)) {
          await recoverExpiredReview(operationError, operationIdentity);
        } else if (reviewAgentClient.isBatchPartial(operationError)) {
          const partialMessage = errorMessageOf(operationError);
          await refreshReviewDiff(true);
          if (
            activeSummaryIdentityRef.current === operationIdentity &&
            mutationRequestTokenRef.current === operationToken
          ) {
            setError(partialMessage);
          }
        } else {
          setError(errorMessageOf(operationError));
        }
      }
    } finally {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setPending(false);
      }
    }
  }

  function handlePullRequestScope(): void {
    const value = window.prompt(
      "输入 GitHub Pull Request URL，例如 https://github.com/owner/repo/pull/123",
      source.kind === "pull-request"
        ? `https://github.com/${source.owner}/${source.repository}/pull/${source.number}`
        : "",
    );
    if (!value) return;
    const identity = parseGithubPullRequestUrl(value.trim());
    if (!identity) {
      flashError("请输入有效的 github.com Pull Request URL");
      return;
    }
    setCurrentPullRequestUrl(value.trim());
    selectSource({ kind: "pull-request", ...identity });
  }

  function revertAll(): void {
    void applyAll("revert");
  }

  function stageAll(): void {
    void applyAll("stage");
  }

  function unstageAll(): void {
    void applyAll("unstage");
  }

  const setDiffFileSectionElement = React.useCallback(
    (path: string, element: HTMLElement | null) => {
      if (element) {
        diffFileSectionRefs.current.set(path, element);
        return;
      }
      diffFileSectionRefs.current.delete(path);
    },
    [],
  );

  function scrollToDiffFile(path: string): void {
    const viewport = diffScrollViewportRef.current;
    const section = diffFileSectionRefs.current.get(path);
    if (!viewport || !section) return;
    const viewportRect = viewport.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    viewport.scrollTo({
      top: viewport.scrollTop + sectionRect.top - viewportRect.top,
      behavior: "smooth",
    });
  }

  function handleSelectFile(path: string): void {
    setSelectedPath(path);
    void loadFileDiff(path);
    if (!largeDiffMode) {
      window.requestAnimationFrame(() => scrollToDiffFile(path));
    }
  }

  const setClampedFileTreePanelWidth = React.useCallback((next: number) => {
    const containerWidth = reviewMainRef.current?.getBoundingClientRect().width;
    setFileTreePanelWidth(clampReviewFileTreePanelWidth(next, containerWidth));
  }, []);

  function handleFileTreePanelResizeKey(
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void {
    if (event.key === "Home") {
      event.preventDefault();
      setClampedFileTreePanelWidth(REVIEW_FILE_TREE_PANEL_MIN_WIDTH);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setClampedFileTreePanelWidth(REVIEW_FILE_TREE_PANEL_MAX_WIDTH);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey
      ? REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP * 3
      : REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP;
    setClampedFileTreePanelWidth(
      fileTreePanelWidth + (event.key === "ArrowLeft" ? step : -step),
    );
  }

  function startFileTreePanelResize(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    if (event.button !== 0) return;
    event.preventDefault();

    fileTreePanelResizeCleanupRef.current?.();

    const startX = event.clientX;
    const startWidth = fileTreePanelWidth;
    const containerRect = reviewMainRef.current?.getBoundingClientRect();
    const containerLeft = containerRect?.left ?? 0;
    const containerWidth = containerRect?.width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let active = true;
    let lastComputedWidth = startWidth;

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const nextWidth = startWidth + startX - moveEvent.clientX;
      const clamped = clampReviewFileTreePanelWidth(nextWidth, containerWidth);
      lastComputedWidth = clamped;

      // Cancel pending frame, then move the preview line via transform (no layout)
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const previewLeft = moveEvent.clientX - containerLeft;
        const previewLine = fileTreeResizePreviewRef.current;
        if (previewLine) {
          previewLine.style.transform = `translateX(${previewLeft}px)`;
        }
      });
    };

    const stopResize = (): void => {
      if (!active) return;
      active = false;

      // Cancel any pending rAF
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }

      // Hide preview line
      const previewLine = fileTreeResizePreviewRef.current;
      if (previewLine) {
        previewLine.style.transform = "";
      }

      setFileTreePanelResizing(false);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("review-file-tree-is-resizing");
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      fileTreePanelResizeCleanupRef.current = null;
      // Commit final width to React state once — expensive layout happens here
      setFileTreePanelWidth(lastComputedWidth);
    };

    setFileTreePanelResizing(true);
    document.body.classList.add("review-file-tree-is-resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
    fileTreePanelResizeCleanupRef.current = stopResize;
  }

  return (
    <aside
      className={hideFileList ? "review-sidebar hide-files" : "review-sidebar"}
      aria-label="本地代码审查"
      data-review-view={reviewView}
      data-wrap-lines={wordWrap ? "true" : "false"}
      ref={reviewRootRef}
    >
      <div
        className={
          source.kind === "branch"
            ? "review-sidebar-toolbar review-sidebar-toolbar--branch"
            : "review-sidebar-toolbar"
        }
      >
        <div className="review-sidebar-title">
          <PopoverMenu
            align="start"
            avoidCollisions={false}
            className="popover-review-scope popover-menu--flex"
            open={scopeMenuOpen}
            side="bottom"
            sideOffset={4}
            width={200}
            trigger={
              <button
                aria-label="切换变更范围"
                className="review-scope-trigger"
                type="button"
              >
                <span className="review-scope-trigger-label">
                  {reviewSourceLabel(source)}
                </span>
                <ChevronDown size={APP_ICON_SIZE} />
              </button>
            }
            onOpenChange={setScopeMenuOpen}
          >
            <PopoverItem
              selected={source.kind === "unstaged"}
              withCheck
              onClick={() => {
                selectSource({ kind: "unstaged" });
              }}
            >
              未暂存
            </PopoverItem>
            <PopoverItem
              selected={source.kind === "staged"}
              withCheck
              onClick={() => {
                selectSource({ kind: "staged" });
              }}
            >
              已暂存
            </PopoverItem>
            <ReviewCommitSourceSubmenu>
              {sourceOptionsState === "loading" ? (
                <div className="review-source-submenu-message">
                  正在加载提交…
                </div>
              ) : sourceOptionsState === "error" ? (
                <>
                  <div className="review-source-submenu-message">
                    无法加载提交记录
                  </div>
                  <PopoverItem
                    onClick={() =>
                      setSourceOptionsRetry((current) => current + 1)
                    }
                  >
                    重试
                  </PopoverItem>
                </>
              ) : commits.length === 0 ? (
                <div className="review-source-submenu-message">
                  分支上暂无提交记录
                </div>
              ) : (
                <div className="review-source-commit-list">
                  {commits.map((commit) => (
                    <PopoverItem
                      key={`commit:${commit.sha}`}
                      selected={
                        source.kind === "commit" &&
                        source.commitSha === commit.sha
                      }
                      withCheck
                      onClick={() =>
                        selectSource({
                          kind: "commit",
                          commitSha: commit.sha,
                        })
                      }
                    >
                      <span
                        className="review-source-commit-row"
                        title={commit.subject || commit.shortSha}
                      >
                        <span>{commit.subject || "无提交信息"}</span>
                        <small>{formatRelativeCommitTime(commit.authoredAt)}</small>
                      </span>
                    </PopoverItem>
                  ))}
                </div>
              )}
            </ReviewCommitSourceSubmenu>
            <PopoverItem
              disabled={pickDefaultReviewBaseBranch(branches) === null}
              selected={source.kind === "branch"}
              withCheck
              onClick={() => {
                const baseBranch = pickDefaultReviewBaseBranch(branches);
                if (baseBranch) {
                  selectSource({ kind: "branch", baseBranch });
                }
              }}
            >
              分支
            </PopoverItem>
            <PopoverItem
              selected={source.kind === "last-turn"}
              withCheck
              onClick={() => void handleLastTurnScope()}
            >
              上一轮
            </PopoverItem>
          </PopoverMenu>
          {summary ? (
            totals.additions > 0 || totals.deletions > 0 ? (
              <span className="review-sidebar-counts">
              <>
                <strong>+{formatPanelNumber(totals.additions)}</strong>
                <em>-{formatPanelNumber(totals.deletions)}</em>
              </>
              </span>
            ) : null
          ) : (
            <span
              aria-label="变更统计不可用"
              className="review-sidebar-counts"
            >
              —
            </span>
          )}
          {source.kind === "branch" ? (
            <div className="review-branch-range">
              <span title={gitStatus?.branchName ?? "HEAD"}>
                {gitStatus?.branchName ?? "HEAD"}
              </span>
              <span aria-hidden="true">→</span>
              <PopoverMenu
                align="start"
                className="popover-review-branches popover-menu--flex"
                open={branchPickerOpen}
                sideOffset={4}
                width={240}
                trigger={
                  <button
                    className="review-branch-range__trigger"
                    type="button"
                  >
                    <span>{source.baseBranch}</span>
                    <ChevronDown size={APP_ICON_SIZE} />
                  </button>
                }
                onOpenChange={setBranchPickerOpen}
              >
                {sourceOptionsState === "loading" ? (
                  <div className="review-source-submenu-message">
                    正在加载分支…
                  </div>
                ) : sourceOptionsState === "error" ? (
                  <>
                    <div className="review-source-submenu-message">
                      无法加载分支
                    </div>
                    <PopoverItem
                      onClick={() =>
                        setSourceOptionsRetry((current) => current + 1)
                      }
                    >
                      重试
                    </PopoverItem>
                  </>
                ) : (
                  branches.map((branch) => (
                    <PopoverItem
                      key={`base-branch:${branch.name}`}
                      selected={source.baseBranch === branch.name}
                      withCheck
                      onClick={() => {
                        selectSource({
                          kind: "branch",
                          baseBranch: branch.name,
                        });
                        setBranchPickerOpen(false);
                      }}
                    >
                      {branch.name}
                    </PopoverItem>
                  ))
                )}
              </PopoverMenu>
            </div>
          ) : null}
        </div>
        <div className="review-sidebar-actions">
          <PopoverMenu
            align="end"
            className="popover-review-more popover-menu--grid"
            open={moreMenuOpen}
            sideOffset={4}
            width={220}
            trigger={
              <Tooltip content="更多">
                <button
                  aria-label="更多"
                  className="message-action"
                  type="button"
                >
                  <Ellipsis size={APP_ICON_SIZE} />
                </button>
              </Tooltip>
            }
            onOpenChange={setMoreMenuOpen}
          >
            <PopoverItem
              icon={<RotateCcw size={APP_ICON_SIZE} />}
              onClick={() => {
                onRefreshDiff();
                void refreshReviewDiff(true);
                setMoreMenuOpen(false);
              }}
            >
              刷新变更
            </PopoverItem>
            <PopoverItem
              icon={<GitFork size={APP_ICON_SIZE} />}
              onClick={() => {
                setMoreMenuOpen(false);
                onCreateBranch();
              }}
            >
              创建分支
            </PopoverItem>
            <PopoverItem
              icon={<GitPullRequestArrow size={APP_ICON_SIZE} />}
              onClick={() => {
                setMoreMenuOpen(false);
                handlePullRequestScope();
              }}
            >
              打开 GitHub Pull Request…
            </PopoverItem>
            <PopoverItem
              icon={<WrapText size={APP_ICON_SIZE} />}
              withCheck
              selected={wordWrap}
              onClick={() => {
                setWordWrap((value) => !value);
                setMoreMenuOpen(false);
              }}
            >
              {wordWrap ? "禁用自动换行" : "启用自动换行"}
            </PopoverItem>
            <PopoverItem
              icon={<File size={APP_ICON_SIZE} />}
              onClick={() => {
                setMoreMenuOpen(false);
              }}
            >
              加载完整文件
            </PopoverItem>
            <PopoverItem
              icon={<Eye size={APP_ICON_SIZE} />}
              withCheck
              selected={richDiffPreview}
              onClick={() => {
                setRichDiffPreview((value) => !value);
                setMoreMenuOpen(false);
              }}
            >
              {richDiffPreview ? "禁用富文本预览" : "启用富文本预览"}
            </PopoverItem>
            <PopoverItem
              icon={<Type size={APP_ICON_SIZE} />}
              withCheck
              selected={textDiff}
              onClick={() => {
                setTextDiff((value) => !value);
                setMoreMenuOpen(false);
              }}
            >
              {textDiff ? "禁用文字差异" : "启用文字差异"}
            </PopoverItem>
            <PopoverItem
              icon={<Code2 size={APP_ICON_SIZE} />}
              withCheck
              selected={showWhitespace}
              onClick={() => {
                setShowWhitespace((value) => !value);
                setMoreMenuOpen(false);
              }}
            >
              {showWhitespace ? "隐藏空白字符" : "显示空白字符"}
            </PopoverItem>
            <PopoverItem
              icon={<Clipboard size={APP_ICON_SIZE} />}
              onClick={() => {
                void copyGitApplyCommand(reviewDiff?.files ?? [], scope);
                setMoreMenuOpen(false);
              }}
            >
              复制 git apply 命令
            </PopoverItem>
          </PopoverMenu>
          <Tooltip content={allCollapsed ? "展开全部差异" : "折叠全部差异"}>
            <button
              aria-label={allCollapsed ? "展开全部差异" : "折叠全部差异"}
              className="message-action"
              type="button"
              onClick={allCollapsed ? expandAllDiffs : collapseAllDiffs}
            >
              {allCollapsed ? (
                <ListChevronsUpDown size={APP_ICON_SIZE} />
              ) : (
                <ListChevronsDownUp size={APP_ICON_SIZE} />
              )}
            </button>
          </Tooltip>
          <Tooltip content="搜索文件">
            <button
              aria-label="搜索文件"
              className="message-action"
              type="button"
              onClick={() => fileSearchInputRef.current?.focus()}
            >
              <Search size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip
            content={
              reviewView === "inline" ? "切换到分离视图" : "切换到统一差异视图"
            }
          >
            <button
              aria-label={
                reviewView === "inline"
                  ? "切换到拆分差异视图"
                  : "切换到统一差异视图"
              }
              className="message-action"
              type="button"
              onClick={onToggleReviewView}
            >
              {reviewView === "inline" ? (
                <Columns2
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : (
                <Rows2
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              )}
            </button>
          </Tooltip>
          <Tooltip content={hideFileList ? "显示文件" : "隐藏文件"}>
            <button
              aria-label={hideFileList ? "显示文件" : "隐藏文件"}
              aria-pressed={!hideFileList}
              className="message-action"
              type="button"
              onClick={() => setHideFileList((value) => !value)}
            >
              <Briefcase size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="提交或推送">
            <Button
              aria-label="提交或推送"
              className="review-sidebar-primary-action"
              ref={commitButtonRef}
              onClick={() => setCommitPopoverOpen((value) => !value)}
            >
              <GitCommitHorizontal size={APP_ICON_SIZE} />
              <span className="review-sidebar-action-label">提交或推送</span>
            </Button>
          </Tooltip>
          <Tooltip content="创建拉取请求">
            <Button
              aria-label="创建拉取请求"
              className="review-sidebar-primary-action"
              ref={prButtonRef}
              onClick={() => setPrPopoverOpen((value) => !value)}
            >
              <GitPullRequestArrow size={APP_ICON_SIZE} />
              <span className="review-sidebar-action-label">创建拉取请求</span>
            </Button>
          </Tooltip>
        </div>
      </div>

      {error ? (
        <div className="review-error-state" role="alert">
          <span>{error}</span>
          <Button
            onClick={() => void refreshReviewDiff(true)}
          >
            重试
          </Button>
        </div>
      ) : null}

      <div
        className={
          fileTreePanelResizing
            ? "review-sidebar-main resizing-file-tree"
            : "review-sidebar-main"
        }
        ref={reviewMainRef}
        style={
          {
            "--review-file-tree-panel-w": `${fileTreePanelWidth}px`,
          } as React.CSSProperties
        }
      >
        {showProjectEmptyState ? (
          <ReviewProjectEmptyState source={source} />
        ) : null}

        {!showProjectEmptyState && visibleFiles.length > 0 ? (
          <ReviewDiffPreview
            attachedComments={attachedComments}
            collapsedDiffPaths={collapsedDiffPaths}
            diffMarkerStyle={diffMarkerStyle}
            draft={draft}
            fileLoadStates={fileLoadStates}
            files={
              largeDiffMode && selectedFile ? [selectedFile] : visibleFiles
            }
            largeDiffMode={largeDiffMode}
            pending={reviewMutationPending}
            scope={scope}
            selectedPath={selectedFile?.path ?? null}
            toggleCollapseDiff={toggleCollapseDiff}
            viewportRef={diffScrollViewportRef}
            view={reviewView}
            wrapLines={wordWrap}
            workspacePath={workspacePath}
            onApplyOperation={(action, target) =>
              void applyOperation(action, target)
            }
            onCreateDraft={setDraft}
            onDeleteComment={(commentId) => void deleteComment(commentId)}
            onDraftBodyChange={(body) =>
              setDraft((current) => (current ? { ...current, body } : current))
            }
            onResolveComment={(commentId) => void resolveComment(commentId)}
            onSaveDraft={() => void saveDraft()}
            onCancelDraft={() => setDraft(null)}
            onFileSectionMount={setDiffFileSectionElement}
            onLoadFile={(path) => void loadFileDiff(path)}
            onRetryFile={(path) => void loadFileDiff(path, "selected")}
            onScroll={handleReviewScroll}
          />
        ) : null}

        {!showProjectEmptyState && !hideFileList ? (
          <>
            <div
              aria-label="调整审查文件导航宽度"
              aria-orientation="vertical"
              aria-valuemax={REVIEW_FILE_TREE_PANEL_MAX_WIDTH}
              aria-valuemin={REVIEW_FILE_TREE_PANEL_MIN_WIDTH}
              aria-valuenow={fileTreePanelWidth}
              className="review-file-tree-resize-handle"
              data-resize-handle="true"
              role="separator"
              tabIndex={0}
              title="拖拽调整文件导航宽度，双击恢复默认宽度"
              onDoubleClick={() =>
                setClampedFileTreePanelWidth(
                  REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH,
                )
              }
              onKeyDown={handleFileTreePanelResizeKey}
              onPointerDown={startFileTreePanelResize}
            />
            <div
              className="review-file-tree-resize-preview"
              ref={fileTreeResizePreviewRef}
            />
            <section
              className="review-file-tree-panel"
              aria-label="审查文件导航"
            >
              <SearchInput
                ref={fileSearchInputRef}
                aria-label="筛选文件"
                className="review-file-search"
                onChange={setSearch}
                placeholder="筛选文件..."
                value={search}
                variant="embedded"
              />

              <ScrollArea
                className="review-file-tree-scroll"
                contentClassName="review-file-tree"
                role="tree"
              >
                {reviewTree.length > 0 ? (
                  reviewTree.map((node) => (
                    <ReviewFileTreeNode
                      collapsedDirs={collapsedDirs}
                      commentCountsByPath={commentCountsByPath}
                      key={node.dirPath || "__root__"}
                      node={node}
                      onSelectFile={handleSelectFile}
                      onToggleDir={toggleDir}
                      selectedPath={selectedFile?.path ?? null}
                    />
                  ))
                ) : (
                  <div className="review-empty-state">
                    {loadState === "loading" && !summary
                      ? "正在加载变更…"
                      : loadState === "not-repository" && !summary
                        ? "当前工作区不是 Git 仓库。"
                        : loadState === "unsupported" && !summary
                          ? "当前 Agent 不支持代码审阅。"
                          : !summary && files.length === 0
                            ? "无法加载变更，请重试。"
                            : files.length === 0
                      ? scope === "staged"
                        ? "暂无已暂存变更。"
                        : "暂无未暂存变更。"
                      : "当前筛选下没有匹配的文件。"}
                  </div>
                )}
              </ScrollArea>

              {staleComments.length > 0 ? (
                <ScrollArea
                  className="review-stale-comments-scroll"
                  contentClassName="review-stale-comments"
                  aria-label="过期评论"
                >
                  <div className="review-stale-title">过期评论</div>
                  {staleComments.map((comment) => (
                    <ReviewComment
                      comment={comment}
                      key={comment.id}
                      stale
                      onDelete={() => void deleteComment(comment.id)}
                      onResolve={() => void resolveComment(comment.id)}
                    />
                  ))}
                </ScrollArea>
              ) : null}
            </section>
          </>
        ) : null}
      </div>

      {!hideFileList &&
      visibleFiles.length > 0 &&
      (source.kind === "unstaged" || source.kind === "staged") ? (
        <footer className="review-footer">
          {scope === "unstaged" ? (
            <>
              <Tooltip content="还原所有未暂存变更">
                <Button
                  disabled={reviewMutationPending}
                  tone="danger"
                  onClick={revertAll}
                >
                  <Undo2 size={APP_ICON_SIZE} />
                  还原全部
                </Button>
              </Tooltip>
              <Tooltip content="暂存所有未暂存文件">
                <Button
                  disabled={reviewMutationPending}
                  onClick={stageAll}
                >
                  <Plus size={APP_ICON_SIZE} />
                  暂存全部
                </Button>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip content="取消暂存所有已暂存文件">
                <Button
                  disabled={reviewMutationPending}
                  onClick={unstageAll}
                >
                  <Undo2 size={APP_ICON_SIZE} />
                  取消暂存全部
                </Button>
              </Tooltip>
              <Tooltip content="还原已暂存变更">
                <Button
                  disabled={reviewMutationPending}
                  tone="danger"
                  onClick={revertAll}
                >
                  <Undo2 size={APP_ICON_SIZE} />
                  还原全部
                </Button>
              </Tooltip>
            </>
          )}
        </footer>
      ) : null}

      {source.kind === "pull-request" ? (
        <footer className="review-footer">
          <Button
            disabled={pending || openComments.length === 0}
            onClick={() => void submitGithubReview("COMMENT")}
          >
            <MessageSquarePlus size={APP_ICON_SIZE} />
            提交评论
          </Button>
          <Button
            disabled={pending}
            onClick={() => void submitGithubReview("APPROVE")}
          >
            <CheckCircle2 size={APP_ICON_SIZE} />
            批准
          </Button>
          <Button
            disabled={pending || openComments.length === 0}
            tone="danger"
            onClick={() => void submitGithubReview("REQUEST_CHANGES")}
          >
            <RotateCcw size={APP_ICON_SIZE} />
            请求修改
          </Button>
        </footer>
      ) : null}

      <CommitPopover
        additions={totals.additions}
        anchorRef={commitButtonRef}
        branchName={gitStatus?.branchName ?? "HEAD"}
        deletions={totals.deletions}
        open={commitPopoverOpen}
        width={420}
        onClose={() => setCommitPopoverOpen(false)}
        onCommit={handleCommit}
        onCommitAndPush={handleCommitAndPush}
        onPush={handlePush}
      />

      <PullRequestPopover
        additions={totals.additions}
        anchorRef={prButtonRef}
        branchName={gitStatus?.branchName ?? null}
        defaultBranch={defaultBranch}
        deletions={totals.deletions}
        open={prPopoverOpen}
        width={420}
        onClose={() => setPrPopoverOpen(false)}
        onCreateDraftPR={handleCreateDraftPR}
        onCreatePR={handleCreatePR}
        onOpenPR={handleOpenPR}
      />
    </aside>
  );
}

export const WorkspaceReviewSidebar = React.memo(WorkspaceReviewSidebarImpl);
WorkspaceReviewSidebar.displayName = "WorkspaceReviewSidebar";
