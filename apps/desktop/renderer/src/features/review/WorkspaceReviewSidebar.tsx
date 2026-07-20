import React from "react";
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
  Trash2,
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
} from "../../../shared/types.js";
import {
  desktopClient,
  WORKSPACE_GIT_CHANGED_EVENT,
} from "../../services/desktopClient.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import { buildPopoverSizingStyle } from "../../components/ui/popoverSizing.js";
import { ScrollArea } from "../../components/ui/ScrollArea.js";
import { Tooltip } from "../../components/ui/Tooltip.js";
import { buildReviewFileTree } from "./buildReviewFileTree.js";
import { buildCommentCountsByPath } from "./reviewCommentUtils.js";
import { CommitPopover } from "./CommitPopover.js";
import { PullRequestPopover } from "./PullRequestPopover.js";
import { ReviewFileTreeNode } from "./ReviewFileTree.js";
import { formatReviewCount } from "./reviewFormat.js";
import {
  isReviewDiffExpanded,
  toggleReviewDiffExpansion,
  type ReviewTabUiState,
} from "../layout/conversationUiState.js";
import { syntaxTokenStyle } from "../syntax/CodeBlock.js";
import { resolveLanguageFromPath } from "../syntax/language.js";
import { resolveThemeId } from "../syntax/theme.js";
import type { SyntaxToken } from "../syntax/types.js";
import { useHighlightedCode } from "../syntax/useHighlightedCode.js";
import { useDesktopTheme } from "../theme/themeContext.js";
import {
  ReviewFileRequestCoordinator,
  reviewAgentClient,
  pickDefaultReviewBaseBranch,
  retainCurrentReviewFileDiffs,
  reviewLoadStateForError,
  reviewSourceLabel,
  summaryFileToDesktop,
  type ReviewBranch,
  type ReviewCommit,
  type ReviewFileDiff,
  type ReviewLoadState,
  type ReviewSummarySnapshot,
} from "./reviewAgentClient.js";

type ReviewFilter = "all" | "added" | "modified" | "removed";

type ReviewDisplayPath = {
  directory: string;
  fileName: string;
};

type ReviewFileLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "error"; message: string };

type CommentAnchor = {
  filePath: string;
  side: DesktopReviewSide;
  lineNumber: number;
  lineContent: string;
};

type CommentDraft = CommentAnchor & {
  body: string;
};

type ReviewSplitRow = {
  id: string;
  left: ReviewCell;
  right: ReviewCell;
  paired: boolean;
};

type ReviewCell = {
  line: DesktopReviewDiffLine | null;
  side: DesktopReviewSide;
  number: number | null;
  content: string;
  tone: "removed" | "added" | "context" | "meta" | "empty";
};

type CodexDiffPaneRow =
  | {
      id: string;
      kind: "hunk";
      hunk: DesktopReviewDiffHunk;
      unmodifiedLines: number;
    }
  | {
      id: string;
      kind: "line";
      cell: ReviewCell;
    };

type ReviewSyntaxByLineId = ReadonlyMap<string, readonly SyntaxToken[]>;

const REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH = 340;
const REVIEW_FILE_TREE_PANEL_MIN_WIDTH = 240;
const REVIEW_FILE_TREE_PANEL_MAX_WIDTH = 520;
const REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP = 24;
const REVIEW_DIFF_PREVIEW_MIN_WIDTH = 260;
const REVIEW_FILE_ACTION_ICON_SIZE = 12;
const ListChevronsDownUp = createLucideIcon("list-chevrons-down-up", [
  ["path", { d: "M3 5h8", key: "18g2rq" }],
  ["path", { d: "M3 12h8", key: "1xfjp6" }],
  ["path", { d: "M3 19h8", key: "fpbke4" }],
  ["path", { d: "m15 5 3 3 3-3", key: "1t4thf" }],
  ["path", { d: "m15 19 3-3 3 3", key: "y4ckd2" }],
]);
const ListChevronsUpDown = createLucideIcon("list-chevrons-up-down", [
  ["path", { d: "M3 5h8", key: "18g2rq" }],
  ["path", { d: "M3 12h8", key: "1xfjp6" }],
  ["path", { d: "M3 19h8", key: "fpbke4" }],
  ["path", { d: "m15 8 3-3 3 3", key: "bc4io6" }],
  ["path", { d: "m15 16 3 3 3-3", key: "9wmg1l" }],
]);
const FILE_HEADER_HEIGHT = 32;
const HUNK_HEADER_HEIGHT = 28;
const DIFF_LINE_HEIGHT = 22;
const EMPTY_FILE_MIN_HEIGHT = 64;

function estimateFilePreviewHeight(file: DesktopReviewDiffFile): number {
  let totalLines = 0;
  let hunksWithContent = 0;
  for (const hunk of file.hunks) {
    if (hunk.lines.length > 0) {
      hunksWithContent++;
      totalLines += hunk.lines.length;
    }
  }
  if (hunksWithContent === 0) return EMPTY_FILE_MIN_HEIGHT;
  return (
    FILE_HEADER_HEIGHT +
    hunksWithContent * HUNK_HEADER_HEIGHT +
    totalLines * DIFF_LINE_HEIGHT
  );
}

function countReviewDiffLines(files: DesktopReviewDiffFile[]): number {
  let total = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      total += hunk.lines.length;
    }
  }
  return total;
}

function splitReviewDisplayPath(path: string): ReviewDisplayPath {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator < 0
    ? { directory: "", fileName: path }
    : {
        directory: path.slice(0, separator + 1),
        fileName: path.slice(separator + 1),
      };
}

/* ── Virtual-scroll flatten helpers ─────────────────────────── */

type DiffVirtualRow =
  | {
      kind: "hunk-header";
      hunk: DesktopReviewDiffHunk;
      unmodifiedLines: number;
    }
  | { kind: "inline-line"; line: DesktopReviewDiffLine }
  | { kind: "split-row"; left: ReviewCell; right: ReviewCell; rowId: string };

function flattenDiffRows(
  file: DesktopReviewDiffFile,
  view: DesktopReviewView,
): DiffVirtualRow[] {
  const rows: DiffVirtualRow[] = [];
  let previousHunk: DesktopReviewDiffHunk | null = null;
  for (const hunk of file.hunks) {
    rows.push({
      kind: "hunk-header",
      hunk,
      unmodifiedLines: countUnmodifiedLinesBeforeHunk(hunk, previousHunk),
    });
    if (view === "split") {
      const splitRows = splitDiffLines(hunk.lines);
      for (const sr of splitRows) {
        rows.push({
          kind: "split-row",
          left: sr.left,
          right: sr.right,
          rowId: sr.id,
        });
      }
    } else {
      for (const line of hunk.lines) {
        rows.push({ kind: "inline-line", line });
      }
    }
    previousHunk = hunk;
  }
  return rows;
}

function countUnmodifiedLinesBeforeHunk(
  hunk: DesktopReviewDiffHunk,
  previousHunk: DesktopReviewDiffHunk | null,
): number {
  const previousOldEnd = previousHunk
    ? previousHunk.oldStart + previousHunk.oldLines
    : 1;
  const previousNewEnd = previousHunk
    ? previousHunk.newStart + previousHunk.newLines
    : 1;
  return Math.max(
    0,
    Math.min(
      hunk.oldStart - previousOldEnd,
      hunk.newStart - previousNewEnd,
    ),
  );
}

function formatUnmodifiedLines(count: number): string {
  return `${count.toLocaleString("en-US")} unmodified ${
    count === 1 ? "line" : "lines"
  }`;
}

export function WorkspaceReviewSidebar({
  activeSessionId,
  defaultBranch,
  gitStatus,
  debugMode = false,
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
}: {
  activeSessionId: string | null;
  defaultBranch: string | null;
  gitStatus: DesktopGitStatus | null;
  debugMode?: boolean;
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
}): React.ReactNode {
  const source = reviewTabState.source;
  const scope: DesktopReviewScope =
    source.kind === "staged" ? "staged" : "unstaged";
  const [reviewDiff, setReviewDiff] = React.useState<Awaited<
    ReturnType<typeof desktopClient.getWorkspaceReviewDiff>
  > | null>(null);
  const [summary, setSummary] = React.useState<ReviewSummarySnapshot | null>(
    null,
  );
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
  const [comments, setComments] = React.useState<DesktopReviewComment[]>([]);
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

  const hideFileList = !reviewTabState.fileTreeVisible;
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
  const loadedDiffsRef = React.useRef<
    ReadonlyMap<string, ReviewFileDiff>
  >(new Map());
  const loadedDiffOptionsRef = React.useRef(new Map<string, boolean>());
  const fileRequestCoordinatorRef = React.useRef(
    new ReviewFileRequestCoordinator(2),
  );
  const activeReviewKeyRef = React.useRef("");
  const refreshRequestRef = React.useRef<{
    key: string;
    force: boolean;
    promise: Promise<{
      snapshot: ReviewSummarySnapshot;
      cacheState: "fresh" | "stale";
    } | null>;
  } | null>(null);
  const diffScrollViewportRef = React.useRef<HTMLDivElement | null>(null);
  const diffFileSectionRefs = React.useRef(new Map<string, HTMLElement>());
  const fileSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const errorTimerRef = React.useRef<number | null>(null);
  const publishedGithubCommentIdsRef = React.useRef(new Set<string>());
  const fileTreePanelResizeCleanupRef = React.useRef<(() => void) | null>(null);
  const resizeFrameRef = React.useRef<number | null>(null);
  const fileTreeResizePreviewRef = React.useRef<HTMLDivElement | null>(null);

  const refreshReviewDiff = React.useCallback((force = false) => {
    const key = `${workspacePath ?? ""}\0${scope}\0${JSON.stringify(source)}`;
    if (activeReviewKeyRef.current !== key) {
      activeReviewKeyRef.current = key;
      summaryRef.current = null;
      loadedDiffsRef.current = new Map();
      loadedDiffOptionsRef.current.clear();
      setSummary(null);
      setLoadedDiffs(new Map());
      setFileLoadStates(new Map());
      setReviewDiff(null);
    }
    const activeRequest = refreshRequestRef.current;
    if (
      activeRequest?.key === key &&
      (!force || activeRequest.force)
    ) return activeRequest.promise;
    const execute = async (): Promise<{
      snapshot: ReviewSummarySnapshot;
      cacheState: "fresh" | "stale";
    } | null> => {
      if (!workspacePath) {
        summaryRef.current = null;
        loadedDiffsRef.current = new Map();
        setSummary(null);
        setLoadedDiffs(new Map());
        setFileLoadStates(new Map());
        setReviewDiff(null);
        setLoadState('not-repository');
        return null;
      }
      try {
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
          force,
        );
        if (activeReviewKeyRef.current !== key) return null;
        const nextSummary = result.snapshot;
        const retainedDiffs = retainCurrentReviewFileDiffs(
          nextSummary,
          loadedDiffsRef.current,
        );
        const retainedPaths = new Set(retainedDiffs.keys());
        for (const path of loadedDiffOptionsRef.current.keys()) {
          if (!retainedPaths.has(path)) loadedDiffOptionsRef.current.delete(path);
        }
        summaryRef.current = nextSummary;
        loadedDiffsRef.current = retainedDiffs;
        setSummary(nextSummary);
        setLoadedDiffs(retainedDiffs);
        setFileLoadStates((current) => {
          const next = new Map<string, ReviewFileLoadState>();
          for (const file of nextSummary.files) {
            if (retainedPaths.has(file.path)) {
              next.set(file.path, { status: "loaded" });
              continue;
            }
            const previous = current.get(file.path);
            if (previous?.status === "error") {
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
              changedFiles: source.kind === "unstaged" ? nextSummary.totals.files : 0,
              additions: source.kind === "unstaged" ? nextSummary.totals.additions : 0,
              deletions: source.kind === "unstaged" ? nextSummary.totals.deletions : 0,
            },
            {
              scope: "staged",
              changedFiles: source.kind === "staged" ? nextSummary.totals.files : 0,
              additions: source.kind === "staged" ? nextSummary.totals.additions : 0,
              deletions: source.kind === "staged" ? nextSummary.totals.deletions : 0,
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
        if (activeReviewKeyRef.current !== key) return null;
        setLoadState(reviewLoadStateForError(refreshError));
        setError(errorMessageOf(refreshError));
        return null;
      }
    };
    const request = activeRequest
      ? activeRequest.promise.then(execute, execute)
      : execute();
    refreshRequestRef.current = { key, force, promise: request };
    void request.finally(() => {
      if (refreshRequestRef.current?.promise === request) refreshRequestRef.current = null;
    });
    return request;
  }, [gitStatus, scope, source, workspacePath]);

  const loadFileDiff = React.useCallback(
    async (
      path: string,
      priority: "selected" | "prefetch" = "prefetch",
      retryExpired = true,
    ): Promise<void> => {
      const currentSummary = summaryRef.current;
      if (!workspacePath || !currentSummary) return;
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
      const failLoad = (loadError: unknown): void => {
        const message = errorMessageOf(loadError);
        setError(message);
        setFileLoadStates((current) =>
          new Map(current).set(path, { status: "error", message }),
        );
      };
      const commitLoaded = (
        loaded: ReviewFileDiff,
        expectedSummary: ReviewSummarySnapshot,
      ): void => {
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
          try {
            const loaded = await reviewAgentClient.fileDiff(
              workspacePath,
              source,
              currentSummary.generation,
              path,
              reviewTabState.hideWhitespace,
            );
            commitLoaded(loaded, currentSummary);
          } catch (loadError) {
            if (
              retryExpired &&
              reviewAgentClient.isSnapshotExpired(loadError)
            ) {
              try {
                const refreshed = await refreshReviewDiff(true);
                if (!refreshed) {
                  failLoad(loadError);
                  return;
                }
                const refreshedFile = refreshed.snapshot.files.find(
                  file => file.path === path,
                );
                if (!refreshedFile) {
                  failLoad(new Error("刷新后找不到该文件差异"));
                  return;
                }
                const loaded = await reviewAgentClient.fileDiff(
                  workspacePath,
                  source,
                  refreshed.snapshot.generation,
                  path,
                  reviewTabState.hideWhitespace,
                );
                commitLoaded(loaded, refreshed.snapshot);
              } catch (retryError) {
                failLoad(retryError);
              }
              return;
            }
            failLoad(loadError);
          }
        },
        priority,
      );
    },
    [
      onReviewTabStateChange,
      refreshReviewDiff,
      reviewTabState.hideWhitespace,
      source,
      summary,
      workspacePath,
    ],
  );

  const refreshComments = React.useCallback(async () => {
    if (!activeSessionId) {
      setComments([]);
      return;
    }
    try {
      if (!workspacePath) {
        setComments([]);
        return;
      }
      setComments(
        await reviewAgentClient.listComments(
          workspacePath,
          activeSessionId,
          source,
        ),
      );
    } catch (refreshError) {
      setError(errorMessageOf(refreshError));
    }
  }, [activeSessionId, source, workspacePath]);

  React.useEffect(() => {
    void refreshReviewDiff().then((result) => {
      if (result?.cacheState === "stale") void refreshReviewDiff(true);
    });
  }, [refreshReviewDiff, isRefreshing]);

  React.useEffect(() => {
    const handleGitChange = (): void => {
      if (reviewRootRef.current?.offsetParent !== null) {
        void refreshReviewDiff(true);
        return;
      }
      staleGitChangeRef.current = true;
    };
    window.addEventListener(WORKSPACE_GIT_CHANGED_EVENT, handleGitChange);
    return () =>
      window.removeEventListener(WORKSPACE_GIT_CHANGED_EVENT, handleGitChange);
  }, [refreshReviewDiff]);

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
    return () => {
      if (errorTimerRef.current !== null) {
        window.clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
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

  const files = reviewDiff?.files ?? [];
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
    summary?.largeDiffMode ??
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
      setError(null);
      await refreshReviewDiff(true);
      onRefreshDiff();
    } catch (operationError) {
      setError(errorMessageOf(operationError));
    } finally {
      setPending(false);
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
      setComments((current) => [
        ...current.filter((comment) => comment.id !== saved.id),
        saved,
      ]);
      setDraft(null);
    } catch (commentError) {
      setError(errorMessageOf(commentError));
    } finally {
      setPending(false);
    }
  }

  async function resolveComment(commentId: string): Promise<void> {
    if (!activeSessionId || !workspacePath) return;
    const resolved = await reviewAgentClient.resolveComment(
      workspacePath,
      activeSessionId,
      commentId,
    );
    setComments((current) =>
      current.map((comment) =>
        comment.id === resolved.id ? resolved : comment,
      ),
    );
  }

  async function deleteComment(commentId: string): Promise<void> {
    if (!activeSessionId || !workspacePath) return;
    await reviewAgentClient.deleteComment(
      workspacePath,
      activeSessionId,
      commentId,
    );
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
    setPending(true);
    try {
      for (const comment of openComments) {
        if (
          comment.githubCommentId ||
          publishedGithubCommentIdsRef.current.has(comment.id)
        ) {
          continue;
        }
        const published = await reviewAgentClient.publishGithubComment(source, {
          body: comment.body,
          path: comment.filePath,
          side: comment.side,
          line: comment.lineNumber,
          expectedHeadRevision,
          commitId: expectedHeadRevision,
        });
        publishedGithubCommentIdsRef.current.add(comment.id);
        if (workspacePath) {
          const linked = await reviewAgentClient.linkGithubComment(
            workspacePath,
            source,
            comment,
            published,
          );
          setComments((current) =>
            current.map((candidate) =>
              candidate.id === linked.id ? linked : candidate,
            ),
          );
        }
      }
      await reviewAgentClient.submitGithubReview(
        source,
        event,
        expectedHeadRevision,
        event === "APPROVE"
          ? undefined
          : `CodePilotX 提交了 ${openComments.length} 条行内审阅评论。`,
      );
      setError(null);
    } catch (reviewError) {
      setError(errorMessageOf(reviewError));
    } finally {
      setPending(false);
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
      setCommitPopoverOpen(false);
      await refreshReviewDiff(true);
      onRefreshDiff();
      return true;
    } catch (commitError) {
      setError(errorMessageOf(commitError));
      return false;
    } finally {
      setPending(false);
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
    setPending(true);
    try {
      const result = await desktopClient.pushWorkspaceBranch({
        workspacePath,
        setUpstream: !gitStatus?.upstream,
      });
      if (result.ok === false) throw new Error(result.error);
      setCommitPopoverOpen(false);
      onRefreshDiff();
    } catch (pushError) {
      setError(errorMessageOf(pushError));
    } finally {
      setPending(false);
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
      setCurrentPullRequestUrl(result.url);
      const identity = parseGithubPullRequestUrl(result.url);
      if (identity) {
        selectSource({ kind: "pull-request", ...identity });
      }
      setPrPopoverOpen(false);
    } catch (pullRequestError) {
      setError(errorMessageOf(pullRequestError));
    } finally {
      setPending(false);
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
    const paths = summary?.files.map((file) => file.path) ?? [];
    if (paths.length === 0) return;
    if (
      action === "revert" &&
      !window.confirm(`确定要丢弃全部 ${paths.length} 个文件的变更吗？此操作无法撤销。`)
    ) {
      return;
    }
    setPending(true);
    const failures: string[] = [];
    try {
      for (const path of paths) {
        try {
          const current = await reviewAgentClient.summary(
            workspacePath,
            source,
            true,
          );
          const file = current.snapshot.files.find(
            (candidate) => candidate.path === path,
          );
          if (!file) continue;
          await reviewAgentClient.apply(workspacePath, {
            source,
            generation: current.snapshot.generation,
            expectedRevision: file.revision,
            action,
            target: { kind: "file", path },
          });
        } catch (operationError) {
          failures.push(`${path}：${errorMessageOf(operationError)}`);
        }
      }
      await refreshReviewDiff(true);
      onRefreshDiff();
      if (failures.length > 0) {
        flashError(
          `已完成 ${paths.length - failures.length}/${paths.length} 项；失败：${failures
            .slice(0, 3)
            .join("；")}`,
        );
      }
    } finally {
      setPending(false);
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
            className="popover-review-scope"
            disableOutsideDismiss={debugMode}
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
                className="popover-review-branches"
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
            className="popover-review-more"
            disableOutsideDismiss={debugMode}
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
            <button
              aria-label="提交或推送"
              className="message-action review-sidebar-primary-action"
              ref={commitButtonRef}
              type="button"
              onClick={() => setCommitPopoverOpen((value) => !value)}
            >
              <GitCommitHorizontal size={APP_ICON_SIZE} />
              <span className="review-sidebar-action-label">提交或推送</span>
            </button>
          </Tooltip>
          <Tooltip content="创建拉取请求">
            <button
              aria-label="创建拉取请求"
              className="message-action review-sidebar-primary-action"
              ref={prButtonRef}
              type="button"
              onClick={() => setPrPopoverOpen((value) => !value)}
            >
              <GitPullRequestArrow size={APP_ICON_SIZE} />
              <span className="review-sidebar-action-label">创建拉取请求</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {error ? (
        <div className="review-error-state" role="alert">
          <span>{error}</span>
          <button
            className="message-action"
            type="button"
            onClick={() => void refreshReviewDiff(true)}
          >
            重试
          </button>
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
            pending={pending}
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
            onScroll={(scrollTop) =>
              onReviewTabStateChange((current) => ({
                ...current,
                scrollTop,
              }))
            }
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
              <label className="review-file-search">
                <Search
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                <input
                  ref={fileSearchInputRef}
                  aria-label="筛选文件"
                  placeholder="筛选文件..."
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

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
                <button type="button" onClick={revertAll}>
                  <Undo2 size={APP_ICON_SIZE} />
                  还原全部
                </button>
              </Tooltip>
              <Tooltip content="暂存所有未暂存文件">
                <button type="button" onClick={stageAll}>
                  <Plus size={APP_ICON_SIZE} />
                  暂存全部
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip content="取消暂存所有已暂存文件">
                <button type="button" onClick={unstageAll}>
                  <Undo2 size={APP_ICON_SIZE} />
                  取消暂存全部
                </button>
              </Tooltip>
              <Tooltip content="还原已暂存变更">
                <button type="button" onClick={revertAll}>
                  <Undo2 size={APP_ICON_SIZE} />
                  还原全部
                </button>
              </Tooltip>
            </>
          )}
        </footer>
      ) : null}

      {source.kind === "pull-request" ? (
        <footer className="review-footer">
          <button
            disabled={pending || openComments.length === 0}
            type="button"
            onClick={() => void submitGithubReview("COMMENT")}
          >
            <MessageSquarePlus size={APP_ICON_SIZE} />
            提交评论
          </button>
          <button
            disabled={pending}
            type="button"
            onClick={() => void submitGithubReview("APPROVE")}
          >
            <CheckCircle2 size={APP_ICON_SIZE} />
            批准
          </button>
          <button
            disabled={pending || openComments.length === 0}
            type="button"
            onClick={() => void submitGithubReview("REQUEST_CHANGES")}
          >
            <RotateCcw size={APP_ICON_SIZE} />
            请求修改
          </button>
        </footer>
      ) : null}

      <CommitPopover
        additions={totals.additions}
        anchorRef={commitButtonRef}
        branchName={gitStatus?.branchName ?? "HEAD"}
        deletions={totals.deletions}
        disableOutsideDismiss={debugMode}
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
        disableOutsideDismiss={debugMode}
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

function ReviewDiffPreview({
  attachedComments,
  collapsedDiffPaths,
  diffMarkerStyle,
  draft,
  fileLoadStates,
  files,
  largeDiffMode,
  pending,
  scope,
  selectedPath,
  toggleCollapseDiff,
  viewportRef,
  view,
  wrapLines,
  workspacePath,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onFileSectionMount,
  onLoadFile,
  onRetryFile,
  onResolveComment,
  onSaveDraft,
  onScroll,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>;
  collapsedDiffPaths: Set<string>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  fileLoadStates: ReadonlyMap<string, ReviewFileLoadState>;
  files: DesktopReviewDiffFile[];
  largeDiffMode: boolean;
  pending: boolean;
  scope: DesktopReviewScope;
  selectedPath: string | null;
  toggleCollapseDiff: (path: string) => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  view: DesktopReviewView;
  wrapLines: boolean;
  workspacePath: string | null;
  onApplyOperation: (
    action: "stage" | "unstage" | "revert",
    target:
      | { type: "file"; path: string }
      | { type: "hunk"; path: string; hunkId: string },
  ) => void;
  onCancelDraft: () => void;
  onCreateDraft: (draft: CommentDraft) => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onFileSectionMount: (path: string, element: HTMLElement | null) => void;
  onLoadFile: (path: string) => void;
  onRetryFile: (path: string) => void;
  onScroll: (scrollTop: number) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  const filePaths = React.useMemo(
    () => files.map((file) => file.path),
    [files],
  );
  const filePathSet = React.useMemo(() => new Set(filePaths), [filePaths]);
  const [windowedPaths, setWindowedPaths] = React.useState<Set<string>>(() => {
    const initialPath = selectedPath ?? filePaths[0];
    return initialPath ? new Set([initialPath]) : new Set();
  });
  const fileSectionElementsRef = React.useRef(new Map<string, HTMLElement>());

  // Refs so the IntersectionObserver callback always sees latest values
  const selectedPathRef = React.useRef(selectedPath);
  selectedPathRef.current = selectedPath;
  const draftFilePathRef = React.useRef(draft?.filePath ?? null);
  draftFilePathRef.current = draft?.filePath ?? null;

  // Sync windowedPaths when files change, or when selectedPath / draft file changes
  React.useEffect(() => {
    setWindowedPaths((current) => {
      const next = new Set<string>();
      for (const path of current) {
        if (filePathSet.has(path)) next.add(path);
      }
      if (selectedPath && filePathSet.has(selectedPath)) next.add(selectedPath);
      if (draft?.filePath && filePathSet.has(draft.filePath))
        next.add(draft.filePath);
      if (next.size === 0 && filePaths[0]) next.add(filePaths[0]);
      return next;
    });
  }, [filePathSet, filePaths, selectedPath, draft?.filePath]);

  // IntersectionObserver for windowing: add near viewport, remove when far out
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = viewportRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setWindowedPaths((current) => {
          let changed = false;
          const next = new Set(current);
          for (const entry of entries) {
            const path = (entry.target as HTMLElement).dataset.reviewDiffPath;
            if (!path) continue;

            if (entry.isIntersecting) {
              if (!collapsedDiffPaths.has(path)) onLoadFile(path);
              if (!next.has(path)) {
                next.add(path);
                changed = true;
              }
            } else if (
              path !== selectedPathRef.current &&
              path !== draftFilePathRef.current
            ) {
              if (next.has(path)) {
                next.delete(path);
                changed = true;
              }
            }
          }
          return changed ? next : current;
        });
      },
      {
        root,
        rootMargin: `${Math.max(0, root.clientHeight)}px 0px`,
      },
    );

    for (const element of fileSectionElementsRef.current.values()) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [collapsedDiffPaths, filePaths, onLoadFile, viewportRef]);

  const setFileSectionElement = React.useCallback(
    (path: string) => (element: HTMLElement | null) => {
      onFileSectionMount(path, element);
      if (element) {
        fileSectionElementsRef.current.set(path, element);
        return;
      }
      fileSectionElementsRef.current.delete(path);
    },
    [onFileSectionMount],
  );

  return (
    <section
      className="review-diff-preview"
      aria-label="工作区 diff"
      data-slot="review-diff-list"
    >
      <ScrollArea
        className="review-diff-scroll"
        contentClassName="review-diff-scroll-content"
        viewportRef={viewportRef}
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
      >
        {files.map((file) => (
          <ReviewDiffFilePreview
            active={file.path === selectedPath}
            attachedComments={attachedComments}
            collapsedDiffPaths={collapsedDiffPaths}
            diffMarkerStyle={diffMarkerStyle}
            draft={draft}
            file={file}
            fileLoadState={
              fileLoadStates.get(file.path) ??
              (file.hunks.length > 0
                ? { status: "loaded" }
                : { status: "idle" })
            }
            key={file.path}
            largeDiffMode={largeDiffMode}
            pending={pending}
            previewHeight={estimateFilePreviewHeight(file)}
            renderBody={
              file.path === selectedPath || windowedPaths.has(file.path)
            }
            scope={scope}
            sectionRef={setFileSectionElement(file.path)}
            toggleCollapseDiff={toggleCollapseDiff}
            onRetryFile={onRetryFile}
            view={view}
            wrapLines={wrapLines}
            workspacePath={workspacePath}
            onApplyOperation={onApplyOperation}
            onCancelDraft={onCancelDraft}
            onCreateDraft={onCreateDraft}
            onDeleteComment={onDeleteComment}
            onDraftBodyChange={onDraftBodyChange}
            onResolveComment={onResolveComment}
            onSaveDraft={onSaveDraft}
          />
        ))}
      </ScrollArea>
    </section>
  );
}

function ReviewDiffFilePreview({
  active,
  attachedComments,
  collapsedDiffPaths,
  diffMarkerStyle,
  draft,
  file,
  fileLoadState,
  largeDiffMode,
  pending,
  previewHeight,
  renderBody,
  scope,
  sectionRef,
  onRetryFile,
  toggleCollapseDiff,
  view,
  wrapLines,
  workspacePath,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  active: boolean;
  attachedComments: Map<string, DesktopReviewComment[]>;
  collapsedDiffPaths: Set<string>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  fileLoadState: ReviewFileLoadState;
  largeDiffMode: boolean;
  pending: boolean;
  previewHeight: number;
  renderBody: boolean;
  scope: DesktopReviewScope;
  sectionRef: (element: HTMLElement | null) => void;
  onRetryFile: (path: string) => void;
  toggleCollapseDiff: (path: string) => void;
  view: DesktopReviewView;
  wrapLines: boolean;
  workspacePath: string | null;
  onApplyOperation: (
    action: "stage" | "unstage" | "revert",
    target:
      | { type: "file"; path: string }
      | { type: "hunk"; path: string; hunkId: string },
  ) => void;
  onCancelDraft: () => void;
  onCreateDraft: (draft: CommentDraft) => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  const hasContent = file.hunks.some((hunk) => hunk.lines.length > 0);
  const isCollapsed = collapsedDiffPaths.has(file.path);
  const displayPath = splitReviewDisplayPath(file.path);

  const virtualize = React.useMemo(() => {
    if (!renderBody || isCollapsed || !hasContent) return false;
    return largeDiffMode;
  }, [renderBody, isCollapsed, hasContent, largeDiffMode]);

  const flattenedRows = React.useMemo(
    () => (virtualize ? flattenDiffRows(file, view) : []),
    [virtualize, file, view],
  );

  let diffBody: React.ReactNode;
  if (isCollapsed) {
    diffBody = null;
  } else if (!renderBody) {
    diffBody = (
      <div
        className="review-diff-lazy-placeholder"
        aria-hidden="true"
        style={{ height: previewHeight }}
      />
    );
  } else if (virtualize) {
    diffBody = (
      <div
        className={
          largeDiffMode
            ? "review-diff-virtual-body fill-space"
            : "review-diff-virtual-body"
        }
        style={
          !largeDiffMode
            ? { height: Math.min(previewHeight - FILE_HEADER_HEIGHT, 600) }
            : undefined
        }
      >
        <ReviewVirtualDiffRows
          attachedComments={attachedComments}
          diffMarkerStyle={diffMarkerStyle}
          draft={draft}
          file={file}
          flattenedRows={flattenedRows}
          pending={pending}
          scope={scope}
          view={view}
          onApplyOperation={onApplyOperation}
          onCancelDraft={onCancelDraft}
          onCreateDraft={onCreateDraft}
          onDeleteComment={onDeleteComment}
          onDraftBodyChange={onDraftBodyChange}
          onResolveComment={onResolveComment}
          onSaveDraft={onSaveDraft}
        />
      </div>
    );
  } else if (
    fileLoadState.status === "idle" ||
    fileLoadState.status === "loading"
  ) {
    diffBody = (
      <div className="review-empty-state review-file-load-state" role="status">
        正在加载文件差异…
      </div>
    );
  } else if (fileLoadState.status === "error") {
    diffBody = (
      <div className="review-empty-state review-file-load-state" role="alert">
        <span>{fileLoadState.message}</span>
        <button type="button" onClick={() => onRetryFile(file.path)}>
          重试
        </button>
      </div>
    );
  } else if (!hasContent) {
    diffBody = (
      <div className="review-empty-state">
        {file.isUntracked
          ? "未跟踪文件暂不展示 hunk 预览，可直接暂存或删除。"
          : "此文件没有可用的 hunk 预览。"}
      </div>
    );
  } else if (view === "split") {
    diffBody = (
      <ReviewDiffSplit
        attachedComments={attachedComments}
        diffMarkerStyle={diffMarkerStyle}
        draft={draft}
        file={file}
        pending={pending}
        scope={scope}
        wrapLines={wrapLines}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onDraftBodyChange={onDraftBodyChange}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
    );
  } else {
    diffBody = (
      <ReviewDiffInline
        attachedComments={attachedComments}
        diffMarkerStyle={diffMarkerStyle}
        draft={draft}
        file={file}
        pending={pending}
        scope={scope}
        wrapLines={wrapLines}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onDraftBodyChange={onDraftBodyChange}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
    );
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleCollapseDiff(file.path);
    }
  }

  return (
    <section
      className={
        virtualize && largeDiffMode
          ? "review-diff-file-preview virtualized fill-space"
          : virtualize
            ? "review-diff-file-preview virtualized"
            : "review-diff-file-preview"
      }
      ref={sectionRef}
      aria-label={`${file.path} diff`}
      data-review-diff-path={file.path}
      data-slot="review-diff-file"
    >
      <div
        className={
          active
            ? "review-file-row active preview-header"
            : "review-file-row preview-header"
        }
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onClick={() => toggleCollapseDiff(file.path)}
        onKeyDown={handleKeyDown}
      >
        <span className="review-file-badge">{fileBadge(file.path)}</span>
        <span className="review-file-path" title={file.path}>
          <span className="review-file-path__content">
            <span className="review-file-path__directory">
              {displayPath.directory}
            </span>
            <span className="review-file-path__name">
              {displayPath.fileName}
            </span>
          </span>
        </span>
        <span className="review-file-counts">
          <strong>+{formatPanelNumber(file.additions)}</strong>
          <em>-{formatPanelNumber(file.deletions)}</em>
        </span>
        <div
          className="review-file-actions review-file-actions-primary"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="group"
          aria-label="文件查看操作"
        >
          <Tooltip content={isCollapsed ? "展开文件差异" : "折叠文件差异"}>
            <button
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? "展开文件差异" : "折叠文件差异"}
              className="message-action review-file-toggle"
              data-expanded={isCollapsed ? "false" : "true"}
              type="button"
              onClick={() => toggleCollapseDiff(file.path)}
            >
              <ChevronRight size={REVIEW_FILE_ACTION_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="打开文件">
            <button
              aria-label="打开文件"
              className="message-action review-file-open"
              disabled={!workspacePath}
              type="button"
              onClick={() => {
                if (!workspacePath) return;
                void desktopClient.openPathWithDefaultTarget(
                  `${workspacePath.replace(/[\\/]$/, "")}/${file.path}`,
                );
              }}
            >
              <ExternalLink size={REVIEW_FILE_ACTION_ICON_SIZE} />
            </button>
          </Tooltip>
        </div>
        <div
          className="review-file-actions review-file-actions-secondary"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="group"
          aria-label="文件 Git 操作"
        >
          <Tooltip content={file.isUntracked ? "删除未跟踪文件" : "还原文件"}>
            <button
              aria-label={file.isUntracked ? "删除未跟踪文件" : "还原文件"}
              className="message-action"
              disabled={pending}
              type="button"
              onClick={() =>
                onApplyOperation("revert", { type: "file", path: file.path })
              }
            >
              {file.isUntracked ? (
                <Trash2 size={REVIEW_FILE_ACTION_ICON_SIZE} />
              ) : (
                <Undo2 size={REVIEW_FILE_ACTION_ICON_SIZE} />
              )}
            </button>
          </Tooltip>
          {scope === "unstaged" ? (
            <Tooltip content="暂存文件">
              <button
                aria-label="暂存文件"
                className="message-action"
                disabled={pending}
                type="button"
                onClick={() =>
                  onApplyOperation("stage", { type: "file", path: file.path })
                }
              >
                <Plus size={REVIEW_FILE_ACTION_ICON_SIZE} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="取消暂存文件">
              <button
                aria-label="取消暂存文件"
                className="message-action"
                disabled={pending}
                type="button"
                onClick={() =>
                  onApplyOperation("unstage", { type: "file", path: file.path })
                }
              >
                <Minus size={REVIEW_FILE_ACTION_ICON_SIZE} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      {diffBody}
    </section>
  );
}

/* ── Virtual-scroll row renderers ──────────────────────────── */

function ReviewVirtualDiffRows({
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  flattenedRows,
  pending,
  scope,
  view,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  flattenedRows: DiffVirtualRow[];
  pending: boolean;
  scope: DesktopReviewScope;
  view: DesktopReviewView;
  onApplyOperation: (
    action: "stage" | "unstage" | "revert",
    target:
      | { type: "file"; path: string }
      | { type: "hunk"; path: string; hunkId: string },
  ) => void;
  onCancelDraft: () => void;
  onCreateDraft: (draft: CommentDraft) => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  const syntaxByLineId = useReviewDiffSyntax(file);

  return (
    <VList
      className="review-diff-vlist"
      style={{ width: "100%", height: "100%" }}
    >
      {flattenedRows.map((row) =>
        row.kind === "hunk-header" ? (
          <div
            className="review-diff-vlist-row"
            key={`hunk-${row.hunk.id}`}
          >
            <ReviewHunkHeader
              file={file}
              hunk={row.hunk}
              unmodifiedLines={row.unmodifiedLines}
              pending={pending}
              scope={scope}
              onApplyOperation={onApplyOperation}
            />
          </div>
        ) : view === "split" && row.kind === "split-row" ? (
          <VirtualDiffSplitRow
            key={row.rowId}
            attachedComments={attachedComments}
            diffMarkerStyle={diffMarkerStyle}
            draft={draft}
            file={file}
            left={row.left}
            right={row.right}
            syntaxByLineId={syntaxByLineId}
            onCancelDraft={onCancelDraft}
            onCreateDraft={onCreateDraft}
            onDeleteComment={onDeleteComment}
            onDraftBodyChange={onDraftBodyChange}
            onResolveComment={onResolveComment}
            onSaveDraft={onSaveDraft}
          />
        ) : row.kind === "inline-line" ? (
          <VirtualDiffInlineRow
            key={row.line.id}
            attachedComments={attachedComments}
            diffMarkerStyle={diffMarkerStyle}
            draft={draft}
            file={file}
            line={row.line}
            syntaxByLineId={syntaxByLineId}
            onCancelDraft={onCancelDraft}
            onCreateDraft={onCreateDraft}
            onDeleteComment={onDeleteComment}
            onDraftBodyChange={onDraftBodyChange}
            onResolveComment={onResolveComment}
            onSaveDraft={onSaveDraft}
          />
        ) : null,
      )}
    </VList>
  );
}

function VirtualDiffInlineRow({
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  line,
  syntaxByLineId,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  line: DesktopReviewDiffLine;
  syntaxByLineId: ReviewSyntaxByLineId;
  onCancelDraft: () => void;
  onCreateDraft: (draft: CommentDraft) => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  const side = line.type === "removed" ? "left" : "right";
  const lineNumber = line.type === "removed" ? line.oldLine : line.newLine;
  const anchor = buildAnchor(file.path, side, lineNumber, line.content);
  const comments = anchor
    ? (attachedComments.get(commentKey(anchor)) ?? [])
    : [];

  return (
    <div className="review-diff-vlist-row">
      <div
        className="review-diff-row u-grid u-items-stretch"
        data-marker-style={diffMarkerStyle}
        data-line-type={line.type}
      >
        <LineCommentButton
          anchor={anchor}
          disabled={!anchor}
          onCreateDraft={onCreateDraft}
        />
        <span
          className="review-diff-line-number u-text-right"
          data-tone={line.type}
        >
          {lineNumber ?? ""}
        </span>
        <DiffMarker tone={line.type} />
        <code className="review-diff-line-content">
          <ReviewSyntaxText
            content={line.content}
            line={line}
            syntaxByLineId={syntaxByLineId}
          />
        </code>
        <LineComments
          comments={comments}
          draft={draft}
          anchor={anchor}
          onCancelDraft={onCancelDraft}
          onDeleteComment={onDeleteComment}
          onDraftBodyChange={onDraftBodyChange}
          onResolveComment={onResolveComment}
          onSaveDraft={onSaveDraft}
        />
      </div>
    </div>
  );
}

function VirtualDiffSplitRow({
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  left,
  right,
  syntaxByLineId,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  left: ReviewCell;
  right: ReviewCell;
  syntaxByLineId: ReviewSyntaxByLineId;
  onCancelDraft: () => void;
  onCreateDraft: (draft: CommentDraft) => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  return (
    <div className="review-diff-vlist-row">
      <div
        className="review-diff-split-row u-grid u-min-w-0"
        data-marker-style={diffMarkerStyle}
        data-layout="paired"
      >
        {[left, right].map((cell) => {
          const anchor = buildAnchor(
            file.path,
            cell.side,
            cell.number,
            cell.content,
          );
          const comments = anchor
            ? (attachedComments.get(commentKey(anchor)) ?? [])
            : [];
          return (
            <div
              className="review-diff-side u-grid u-min-w-0"
              data-tone={cell.tone}
              key={cell.side}
            >
              <LineCommentButton
                anchor={anchor}
                disabled={!anchor}
                onCreateDraft={onCreateDraft}
              />
              <span
                className="review-diff-line-number u-text-right"
                data-tone={cell.tone}
              >
                {cell.number ?? ""}
              </span>
              <DiffMarker tone={cell.tone} />
              <code className="review-diff-line-content">
                {cell.tone === "empty" ? (
                  " "
                ) : (
                  <ReviewSyntaxText
                    content={cell.content}
                    line={cell.line}
                    syntaxByLineId={syntaxByLineId}
                  />
                )}
              </code>
              <LineComments
                comments={comments}
                draft={draft}
                anchor={anchor}
                onCancelDraft={onCancelDraft}
                onDeleteComment={onDeleteComment}
                onDraftBodyChange={onDraftBodyChange}
                onResolveComment={onResolveComment}
                onSaveDraft={onSaveDraft}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewDiffInline({
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  pending,
  scope,
  wrapLines,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: ReviewDiffBodyProps): React.ReactNode {
  const rows = buildUnifiedDiffRows(file);
  const syntaxByLineId = useReviewDiffSyntax(file);
  return (
    <pre
      className="review-codex-diff"
      data-diff=""
      data-diff-type="single"
      data-indicators={diffMarkerStyle === "symbol" ? "classic" : "bars"}
      data-overflow={wrapLines ? "wrap" : "scroll"}
    >
      <ReviewDiffCodePane
        attachedComments={attachedComments}
        draft={draft}
        file={file}
        pane="unified"
        pending={pending}
        rows={rows}
        scope={scope}
        syntaxByLineId={syntaxByLineId}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onDraftBodyChange={onDraftBodyChange}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
    </pre>
  );
}

function ReviewDiffSplit({
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  pending,
  scope,
  wrapLines,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: ReviewDiffBodyProps): React.ReactNode {
  const rootRef = React.useRef<HTMLPreElement>(null);
  const { leftRows, rightRows } = React.useMemo(
    () => buildSplitDiffRows(file),
    [file],
  );
  const syntaxByLineId = useReviewDiffSyntax(file);
  useSyncCodexSplitRows(rootRef, !wrapLines, file);

  return (
    <pre
      className="review-codex-diff"
      data-diff=""
      data-diff-type="split"
      data-indicators={diffMarkerStyle === "symbol" ? "classic" : "bars"}
      data-overflow={wrapLines ? "wrap" : "scroll"}
      ref={rootRef}
    >
      <ReviewDiffCodePane
        attachedComments={attachedComments}
        draft={draft}
        file={file}
        pane="deletions"
        pending={pending}
        rows={leftRows}
        scope={scope}
        syncRows={!wrapLines}
        syntaxByLineId={syntaxByLineId}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onDraftBodyChange={onDraftBodyChange}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
      <ReviewDiffCodePane
        attachedComments={attachedComments}
        draft={draft}
        file={file}
        pane="additions"
        pending={pending}
        rows={rightRows}
        scope={scope}
        syncRows={!wrapLines}
        syntaxByLineId={syntaxByLineId}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onDraftBodyChange={onDraftBodyChange}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
    </pre>
  );
}

function ReviewDiffCodePane({
  attachedComments,
  draft,
  file,
  pane,
  pending,
  rows,
  scope,
  syncRows = false,
  syntaxByLineId,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: Omit<ReviewDiffBodyProps, "diffMarkerStyle" | "wrapLines"> & {
  pane: "unified" | "deletions" | "additions";
  rows: CodexDiffPaneRow[];
  syncRows?: boolean;
  syntaxByLineId: ReviewSyntaxByLineId;
}): React.ReactNode {
  const rowSpan = Math.max(rows.length, 1);
  const columnStyle = {
    gridRow: `1 / span ${rowSpan}`,
  } as React.CSSProperties;

  return (
    <code
      className="review-codex-diff__code"
      data-code=""
      data-unified={pane === "unified" ? "" : undefined}
      data-deletions={pane === "deletions" ? "" : undefined}
      data-additions={pane === "additions" ? "" : undefined}
      style={{
        "--review-diff-row-count": rowSpan,
      } as React.CSSProperties}
    >
      <div className="review-codex-diff__gutter" data-gutter="" style={columnStyle}>
        {rows.map((row) => {
          if (row.kind === "hunk") {
            return (
              <div
                className="review-codex-diff__hunk review-codex-diff__hunk--gutter"
                data-diff-sync-row={syncRows ? row.id : undefined}
                data-separator="line-info"
                key={`gutter-${row.id}`}
              />
            );
          }

          const { cell } = row;
          const anchor = buildAnchor(
            file.path,
            cell.side,
            cell.number,
            cell.content,
          );
          return (
            <div
              className="review-codex-diff__number"
              data-column-number={cell.number ?? ""}
              data-diff-sync-row={syncRows ? row.id : undefined}
              data-line-type={codexDiffLineType(cell.tone)}
              key={`gutter-${row.id}`}
            >
              <LineCommentButton
                anchor={anchor}
                disabled={!anchor}
                onCreateDraft={onCreateDraft}
              />
              <span data-line-number-content="">{cell.number ?? ""}</span>
            </div>
          );
        })}
      </div>

      <div className="review-codex-diff__content" data-content="" style={columnStyle}>
        {rows.map((row) => {
          if (row.kind === "hunk") {
            return (
              <div
                className="review-codex-diff__hunk review-codex-diff__hunk--content"
                data-diff-sync-row={syncRows ? row.id : undefined}
                data-separator="line-info"
                key={`content-${row.id}`}
              >
                <div data-separator-wrapper="">
                  <span data-separator-content="">
                    {formatUnmodifiedLines(row.unmodifiedLines)}
                  </span>
                  {pane === "additions" ? null : (
                    <ReviewHunkActions
                      file={file}
                      hunk={row.hunk}
                      pending={pending}
                      scope={scope}
                      onApplyOperation={onApplyOperation}
                    />
                  )}
                </div>
              </div>
            );
          }

          const { cell } = row;
          const anchor = buildAnchor(
            file.path,
            cell.side,
            cell.number,
            cell.content,
          );
          const comments = anchor
            ? (attachedComments.get(commentKey(anchor)) ?? [])
            : [];
          return (
            <div
              className="review-codex-diff__line"
              data-diff-sync-row={syncRows ? row.id : undefined}
              data-line=""
              data-line-type={codexDiffLineType(cell.tone)}
              key={`content-${row.id}`}
            >
              <span className="review-codex-diff__line-text">
                {cell.tone === "empty" ? (
                  " "
                ) : (
                  <ReviewSyntaxText
                    content={cell.content}
                    line={cell.line}
                    syntaxByLineId={syntaxByLineId}
                  />
                )}
              </span>
              <LineComments
                comments={comments}
                draft={draft}
                anchor={anchor}
                onCancelDraft={onCancelDraft}
                onDeleteComment={onDeleteComment}
                onDraftBodyChange={onDraftBodyChange}
                onResolveComment={onResolveComment}
                onSaveDraft={onSaveDraft}
              />
            </div>
          );
        })}
      </div>
    </code>
  );
}

function buildUnifiedDiffRows(file: DesktopReviewDiffFile): CodexDiffPaneRow[] {
  const rows: CodexDiffPaneRow[] = [];
  let previousHunk: DesktopReviewDiffHunk | null = null;
  for (const hunk of file.hunks) {
    rows.push({
      id: `hunk:${hunk.id}`,
      kind: "hunk",
      hunk,
      unmodifiedLines: countUnmodifiedLinesBeforeHunk(hunk, previousHunk),
    });
    for (const line of hunk.lines) {
      const side = line.type === "removed" ? "left" : "right";
      rows.push({
        id: `line:${line.id}`,
        kind: "line",
        cell: {
          line,
          side,
          number: line.type === "removed" ? line.oldLine : line.newLine,
          content: line.content,
          tone: line.type,
        },
      });
    }
    previousHunk = hunk;
  }
  return rows;
}

function useReviewDiffSyntax(
  file: DesktopReviewDiffFile,
): ReviewSyntaxByLineId {
  const { activeTheme, codeThemeId } = useDesktopTheme();
  const theme = resolveThemeId(codeThemeId, activeTheme.variant);
  const lines = React.useMemo(
    () => file.hunks.flatMap((hunk) => hunk.lines),
    [file.hunks],
  );
  const code = React.useMemo(
    () => lines.map((line) => line.content).join("\n"),
    [lines],
  );
  const presentation = useHighlightedCode({
    code,
    language: resolveLanguageFromPath(file.path),
    theme,
  });

  return React.useMemo(() => {
    const tokens = presentation.highlighted?.tokens;
    if (!tokens) return new Map<string, readonly SyntaxToken[]>();

    const byLineId = new Map<string, readonly SyntaxToken[]>();
    for (const [index, line] of lines.entries()) {
      byLineId.set(line.id, tokens[index] ?? []);
    }
    return byLineId;
  }, [lines, presentation.highlighted]);
}

function ReviewSyntaxText({
  content,
  line,
  syntaxByLineId,
}: {
  content: string;
  line: DesktopReviewDiffLine | null;
  syntaxByLineId: ReviewSyntaxByLineId;
}): React.ReactNode {
  const tokens = line ? syntaxByLineId.get(line.id) : undefined;
  if (!tokens || tokens.length === 0) return content || " ";

  return tokens.map((token, index) => (
    <span key={`${line.id}:${index}`} style={syntaxTokenStyle(token)}>
      {token.content}
    </span>
  ));
}

function buildSplitDiffRows(file: DesktopReviewDiffFile): {
  leftRows: CodexDiffPaneRow[];
  rightRows: CodexDiffPaneRow[];
} {
  const leftRows: CodexDiffPaneRow[] = [];
  const rightRows: CodexDiffPaneRow[] = [];
  let previousHunk: DesktopReviewDiffHunk | null = null;
  for (const hunk of file.hunks) {
    const hunkId = `hunk:${hunk.id}`;
    const unmodifiedLines = countUnmodifiedLinesBeforeHunk(
      hunk,
      previousHunk,
    );
    leftRows.push({
      id: hunkId,
      kind: "hunk",
      hunk,
      unmodifiedLines,
    });
    rightRows.push({
      id: hunkId,
      kind: "hunk",
      hunk,
      unmodifiedLines,
    });
    for (const row of splitDiffLines(hunk.lines)) {
      const rowId = `line:${row.id}`;
      leftRows.push({ id: rowId, kind: "line", cell: row.left });
      rightRows.push({ id: rowId, kind: "line", cell: row.right });
    }
    previousHunk = hunk;
  }
  return { leftRows, rightRows };
}

function codexDiffLineType(cell: ReviewCell["tone"]): string {
  if (cell === "added") return "change-addition";
  if (cell === "removed") return "change-deletion";
  if (cell === "empty") return "buffer";
  if (cell === "meta") return "metadata";
  return "context";
}

function useSyncCodexSplitRows(
  rootRef: React.RefObject<HTMLPreElement | null>,
  enabled: boolean,
  revision: unknown,
): void {
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const sync = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const groups = new Map<string, HTMLElement[]>();
        for (const node of root.querySelectorAll<HTMLElement>(
          "[data-diff-sync-row]",
        )) {
          node.style.minHeight = "";
          const key = node.dataset.diffSyncRow;
          if (!key) continue;
          const group = groups.get(key) ?? [];
          group.push(node);
          groups.set(key, group);
        }
        for (const group of groups.values()) {
          const height = Math.max(
            ...group.map((node) => node.getBoundingClientRect().height),
          );
          for (const node of group) node.style.minHeight = `${height}px`;
        }
      });
    };

    const observedHeights = new WeakMap<Element, number>();
    const observer = new ResizeObserver((entries) => {
      let blockSizeChanged = false;
      for (const entry of entries) {
        const nextHeight =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const previousHeight = observedHeights.get(entry.target);
        observedHeights.set(entry.target, nextHeight);
        if (
          previousHeight === undefined ||
          Math.abs(previousHeight - nextHeight) > 0.5
        ) {
          blockSizeChanged = true;
        }
      }
      if (blockSizeChanged) sync();
    });
    observer.observe(root);
    for (const node of root.querySelectorAll<HTMLElement>(
      "[data-diff-sync-row]",
    )) {
      observer.observe(node);
    }
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [enabled, revision, rootRef]);
}

type ReviewDiffBodyProps = {
  attachedComments: Map<string, DesktopReviewComment[]>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  pending: boolean;
  scope: DesktopReviewScope;
  wrapLines: boolean;
  onApplyOperation: (
    action: "stage" | "unstage" | "revert",
    target:
      | { type: "file"; path: string }
      | { type: "hunk"; path: string; hunkId: string },
  ) => void;
  onCancelDraft: () => void;
  onCreateDraft: (draft: CommentDraft) => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
};

function DiffMarker({
  tone,
}: {
  tone: DesktopReviewDiffLine["type"] | ReviewCell["tone"];
}): React.ReactNode {
  return (
    <span className="review-diff-marker" data-tone={tone} aria-hidden="true">
      {tone === "added" ? "+" : tone === "removed" ? "-" : ""}
    </span>
  );
}

function ReviewHunkHeader({
  file,
  hunk,
  unmodifiedLines,
  pending,
  scope,
  onApplyOperation,
}: {
  file: DesktopReviewDiffFile;
  hunk: DesktopReviewDiffHunk;
  unmodifiedLines: number;
  pending: boolean;
  scope: DesktopReviewScope;
  onApplyOperation: (
    action: "stage" | "unstage" | "revert",
    target: { type: "hunk"; path: string; hunkId: string },
  ) => void;
}): React.ReactNode {
  return (
    <div
      className="review-diff-row u-grid u-items-stretch"
      data-line-type="hunk"
    >
      <span className="review-diff-line-content">
        {formatUnmodifiedLines(unmodifiedLines)}
      </span>
      <ReviewHunkActions
        file={file}
        hunk={hunk}
        pending={pending}
        scope={scope}
        onApplyOperation={onApplyOperation}
      />
    </div>
  );
}

function ReviewHunkActions({
  file,
  hunk,
  pending,
  scope,
  onApplyOperation,
}: {
  file: DesktopReviewDiffFile;
  hunk: DesktopReviewDiffHunk;
  pending: boolean;
  scope: DesktopReviewScope;
  onApplyOperation: (
    action: "stage" | "unstage" | "revert",
    target: { type: "hunk"; path: string; hunkId: string },
  ) => void;
}): React.ReactNode {
  return (
    <div className="review-hunk-actions" role="toolbar" aria-label="Hunk 操作">
      {scope === "unstaged" ? (
        <>
          <button
            disabled={pending}
            type="button"
            onClick={() =>
              onApplyOperation("stage", {
                type: "hunk",
                path: file.path,
                hunkId: hunk.id,
              })
            }
          >
            暂存 hunk
          </button>
          <button
            disabled={pending}
            type="button"
            onClick={() =>
              onApplyOperation("revert", {
                type: "hunk",
                path: file.path,
                hunkId: hunk.id,
              })
            }
          >
            还原
          </button>
        </>
      ) : (
        <button
          disabled={pending}
          type="button"
          onClick={() =>
            onApplyOperation("unstage", {
              type: "hunk",
              path: file.path,
              hunkId: hunk.id,
            })
          }
        >
          取消暂存
        </button>
      )}
    </div>
  );
}

function LineCommentButton({
  anchor,
  disabled,
  onCreateDraft,
}: {
  anchor: CommentAnchor | null;
  disabled: boolean;
  onCreateDraft: (draft: CommentDraft) => void;
}): React.ReactNode {
  return (
    <button
      aria-label="添加行内评论"
      className="review-line-comment-button"
      disabled={disabled || !anchor}
      type="button"
      onClick={() => {
        if (!anchor) return;
        onCreateDraft({ ...anchor, body: "" });
      }}
    >
      <MessageSquarePlus size={12} />
    </button>
  );
}

function LineComments({
  anchor,
  comments,
  draft,
  onCancelDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  anchor: CommentAnchor | null;
  comments: DesktopReviewComment[];
  draft: CommentDraft | null;
  onCancelDraft: () => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  const draftMatches =
    anchor && draft ? commentKey(anchor) === commentKey(draft) : false;
  if (comments.length === 0 && !draftMatches) return null;
  return (
    <div className="review-line-comments">
      {comments.map((comment) => (
        <ReviewComment
          comment={comment}
          key={comment.id}
          onDelete={() => onDeleteComment(comment.id)}
          onResolve={() => onResolveComment(comment.id)}
        />
      ))}
      {draftMatches ? (
        <div className="review-comment draft">
          <textarea
            autoFocus
            placeholder="写下这行的问题或修改建议"
            value={draft?.body ?? ""}
            onChange={(event) => onDraftBodyChange(event.target.value)}
          />
          <div className="review-comment-actions">
            <button type="button" onClick={onCancelDraft}>
              取消
            </button>
            <button
              disabled={!draft?.body.trim()}
              type="button"
              onClick={onSaveDraft}
            >
              保存
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReviewComment({
  comment,
  stale = false,
  onDelete,
  onResolve,
}: {
  comment: DesktopReviewComment;
  stale?: boolean;
  onDelete: () => void;
  onResolve: () => void;
}): React.ReactNode {
  return (
    <div className={`review-comment ${comment.status} ${stale ? "stale" : ""}`}>
      <div className="review-comment-meta">
        <span>
          {comment.filePath}:{comment.lineNumber}
        </span>
        <span>{comment.side === "left" ? "旧行" : "新行"}</span>
      </div>
      <div className="review-comment-body">{comment.body}</div>
      <div className="review-comment-actions">
        {comment.status === "open" ? (
          <button type="button" onClick={onResolve}>
            <CheckCircle2 size={12} />
            解决
          </button>
        ) : null}
        <button type="button" onClick={onDelete}>
          <Trash2 size={12} />
          删除
        </button>
      </div>
    </div>
  );
}

function splitDiffLines(lines: DesktopReviewDiffLine[]): ReviewSplitRow[] {
  const rows: ReviewSplitRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (line.type === "removed" && lines[index + 1]?.type === "added") {
      const next = lines[index + 1]!;
      rows.push({
        id: `${line.id}-${next.id}`,
        left: {
          line,
          side: "left",
          number: line.oldLine,
          content: line.content,
          tone: "removed",
        },
        right: {
          line: next,
          side: "right",
          number: next.newLine,
          content: next.content,
          tone: "added",
        },
        paired: true,
      });
      index += 1;
      continue;
    }
    if (line.type === "removed") {
      rows.push({
        id: line.id,
        left: {
          line,
          side: "left",
          number: line.oldLine,
          content: line.content,
          tone: "removed",
        },
        right: emptyCell("right"),
        paired: false,
      });
      continue;
    }
    if (line.type === "added") {
      rows.push({
        id: line.id,
        left: emptyCell("left"),
        right: {
          line,
          side: "right",
          number: line.newLine,
          content: line.content,
          tone: "added",
        },
        paired: false,
      });
      continue;
    }
    rows.push({
      id: line.id,
      left: {
        line,
        side: "left",
        number: line.oldLine,
        content: line.content,
        tone: "context",
      },
      right: {
        line,
        side: "right",
        number: line.newLine,
        content: line.content,
        tone: "context",
      },
      paired: true,
    });
  }
  return rows;
}

function emptyCell(side: DesktopReviewSide): ReviewCell {
  return {
    line: null,
    side,
    number: null,
    content: "",
    tone: "empty",
  };
}

function clampReviewFileTreePanelWidth(
  width: number,
  containerWidth?: number,
): number {
  const containerMax =
    typeof containerWidth === "number" && Number.isFinite(containerWidth)
      ? Math.max(
          REVIEW_FILE_TREE_PANEL_MIN_WIDTH,
          containerWidth - REVIEW_DIFF_PREVIEW_MIN_WIDTH,
        )
      : REVIEW_FILE_TREE_PANEL_MAX_WIDTH;
  const maxWidth = Math.min(REVIEW_FILE_TREE_PANEL_MAX_WIDTH, containerMax);
  return Math.round(
    Math.min(Math.max(width, REVIEW_FILE_TREE_PANEL_MIN_WIDTH), maxWidth),
  );
}

function attachComments(
  files: DesktopReviewDiffFile[],
  comments: DesktopReviewComment[],
): {
  attachedComments: Map<string, DesktopReviewComment[]>;
  staleComments: DesktopReviewComment[];
} {
  const anchors = new Set<string>();
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.oldLine !== null) {
          anchors.add(
            commentKey({
              filePath: file.path,
              side: "left",
              lineNumber: line.oldLine,
              lineContent: line.content,
            }),
          );
        }
        if (line.newLine !== null) {
          anchors.add(
            commentKey({
              filePath: file.path,
              side: "right",
              lineNumber: line.newLine,
              lineContent: line.content,
            }),
          );
        }
      }
    }
  }
  const attachedComments = new Map<string, DesktopReviewComment[]>();
  const staleComments: DesktopReviewComment[] = [];
  for (const comment of comments) {
    if (comment.status === "resolved") continue;
    const key = commentKey(comment);
    if (!anchors.has(key)) {
      staleComments.push(comment);
      continue;
    }
    attachedComments.set(key, [...(attachedComments.get(key) ?? []), comment]);
  }
  return { attachedComments, staleComments };
}

function buildAnchor(
  filePath: string,
  side: DesktopReviewSide,
  lineNumber: number | null,
  lineContent: string,
): CommentAnchor | null {
  if (lineNumber === null) return null;
  return { filePath, side, lineNumber, lineContent };
}

function commentKey(anchor: CommentAnchor): string {
  return `${anchor.filePath}\u0000${anchor.side}\u0000${anchor.lineNumber}\u0000${anchor.lineContent}`;
}

function filterStatusForFile(file: DesktopReviewDiffFile): ReviewFilter {
  if (file.isUntracked) return "added";
  const trimmed = file.status.trim();
  if (trimmed.startsWith("A") || trimmed.startsWith("??")) return "added";
  if (trimmed.startsWith("D")) return "removed";
  return "modified";
}

function reviewFilterLabel(filter: ReviewFilter): string {
  switch (filter) {
    case "added":
      return "新增";
    case "modified":
      return "修改";
    case "removed":
      return "删除";
    default:
      return "全部";
  }
}

function ReviewCommitSourceSubmenu({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className="popover-item popover-sub-trigger"
        tabIndex={-1}
      >
        <span className="popover-item-leading" />
        <span className="popover-item-label">提交</span>
        <span className="popover-item-trailing">
          <ChevronRight
            className="popover-item-arrow"
            size={APP_ICON_SIZE}
          />
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          alignOffset={-6}
          className="popover-surface popover popover-sub-content popover-review-commits"
          sideOffset={8}
          style={buildPopoverSizingStyle({ width: 320 })}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function ReviewProjectEmptyState({
  source,
}: {
  source: DesktopReviewSource;
}): React.ReactNode {
  if (source.kind === "unstaged") {
    return (
      <div className="review-project-empty-state">
        <div className="review-project-empty-state__copy">
          <strong>无未暂存更改</strong>
          <span>代码更改将在此处显示</span>
        </div>
      </div>
    );
  }
  if (source.kind === "staged") {
    return (
      <div className="review-project-empty-state">
        <div className="review-project-empty-state__copy">
          <strong>无暂存更改</strong>
          <span>接受编辑内容并暂存</span>
        </div>
      </div>
    );
  }
  return (
    <div className="review-project-empty-state">
      <div className="review-project-empty-state__content">
        <FileDiff aria-hidden="true" />
        <div className="review-project-empty-state__copy">
          <strong>尚无文件更改</strong>
          <span>此项目中的更改将显示在此处。</span>
        </div>
      </div>
    </div>
  );
}

function formatRelativeCommitTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "刚刚";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`;
  return `${Math.floor(elapsed / day)} 天前`;
}

function scopeLabel(scope: DesktopReviewScope): string {
  switch (scope) {
    case "staged":
      return "已暂存";
    default:
      return "未暂存";
  }
}

function fileBadge(path: string): React.ReactNode {
  const ext = path.split(".").pop()?.slice(0, 4).toUpperCase();
  return ext || <FileDiff size={APP_ICON_SIZE} />;
}

function formatPanelNumber(value: number): string {
  return formatReviewCount(value);
}

function buildReviewComposerPrompt(
  gitStatus: DesktopGitStatus | null,
  files: DesktopReviewDiffFile[],
): string {
  const changedFiles = files.length > 0 ? files : [];
  const fileList =
    changedFiles.length > 0
      ? changedFiles
          .slice(0, 50)
          .map(
            (file) => `- ${file.path} (+${file.additions}/-${file.deletions})`,
          )
          .join("\n")
      : gitStatus?.files.length
        ? gitStatus.files
            .slice(0, 50)
            .map((file) => `- ${file.path} (${file.status.trim() || "已修改"})`)
            .join("\n")
        : "- 当前没有可用变更";
  return [
    "请对当前工作区变更发起一次代码审查。",
    "",
    "变更文件：",
    fileList,
  ].join("\n");
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseGithubPullRequestUrl(
  value: string,
): { owner: string; repository: string; number: number } | null {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/u.exec(url.pathname);
    if (!match) return null;
    return {
      owner: decodeURIComponent(match[1] ?? ""),
      repository: decodeURIComponent(match[2] ?? ""),
      number: Number.parseInt(match[3] ?? "", 10),
    };
  } catch {
    return null;
  }
}

async function copyGitApplyCommand(
  files: DesktopReviewDiffFile[],
  scope: DesktopReviewScope,
): Promise<void> {
  const patches: string[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      if (hunk.lines.length === 0) continue;
      patches.push(hunk.patch);
    }
  }
  if (patches.length === 0) return;
  const cmd = scope === "staged" ? "git apply --cached" : "git apply";
  const text = `${cmd} << 'EOF'\n${patches.join("\n")}\nEOF`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard write may fail in some contexts; silently ignore
  }
}
