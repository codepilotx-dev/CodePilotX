import React from "react";
import { VList } from "virtua";
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Clipboard,
  Code2,
  Columns2,
  Ellipsis,
  Eye,
  File,
  FileDiff,
  GitCommitHorizontal,
  GitFork,
  GitPullRequestArrow,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Search,
  Sliders,
  Trash2,
  Type,
  Undo2,
  Upload,
  WrapText,
} from "lucide-react";
import type {
  DesktopDiffMarkerStyle,
  DesktopGitStatus,
  DesktopReviewComment,
  DesktopReviewDiffFile,
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
  DesktopReviewScope,
  DesktopReviewSide,
  DesktopReviewView,
  DesktopSessionStatus,
} from "../../../shared/types.js";
import { desktopClient } from "../../services/desktopClient.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import { ScrollArea } from "../../components/ui/ScrollArea.js";
import { Tooltip } from "../../components/ui/Tooltip.js";
import { buildReviewFileTree } from "./buildReviewFileTree.js";
import { buildCommentCountsByPath } from "./reviewCommentUtils.js";
import { CommitPopover } from "./CommitPopover.js";
import { PullRequestPopover } from "./PullRequestPopover.js";
import { ReviewFileTreeNode } from "./ReviewFileTree.js";

type ReviewFilter = "all" | "added" | "modified" | "removed";

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
  tone: "removed" | "added" | "context" | "empty";
};

const REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH = 340;
const REVIEW_FILE_TREE_PANEL_MIN_WIDTH = 240;
const REVIEW_FILE_TREE_PANEL_MAX_WIDTH = 520;
const REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP = 24;
const REVIEW_DIFF_PREVIEW_MIN_WIDTH = 260;
const REVIEW_DIFF_LAZY_ROOT_MARGIN = "900px 0px";
const FILE_HEADER_HEIGHT = 44;
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

/* ── Virtual-scroll flatten helpers ─────────────────────────── */

type DiffVirtualRow =
  | { kind: "hunk-header"; hunk: DesktopReviewDiffHunk }
  | { kind: "inline-line"; line: DesktopReviewDiffLine }
  | { kind: "split-row"; left: ReviewCell; right: ReviewCell; rowId: string };

function flattenDiffRows(
  file: DesktopReviewDiffFile,
  view: DesktopReviewView,
): DiffVirtualRow[] {
  const rows: DiffVirtualRow[] = [];
  for (const hunk of file.hunks) {
    rows.push({ kind: "hunk-header", hunk });
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
  }
  return rows;
}

export function WorkspaceReviewSidebar({
  activeSessionId,
  defaultBranch,
  gitStatus,
  debugMode = false,
  isRefreshing,
  diffMarkerStyle,
  reviewView,
  sessionStatus,
  workspacePath,
  onAppendComposerText,
  onClose,
  onCreateBranch,
  onOpenWorkspacePath,
  onRefreshDiff,
  onToggleReviewView,
}: {
  activeSessionId: string | null;
  defaultBranch: string | null;
  gitStatus: DesktopGitStatus | null;
  debugMode?: boolean;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  isRefreshing: boolean;
  reviewView: DesktopReviewView;
  sessionStatus: DesktopSessionStatus;
  workspacePath: string | null;
  onAppendComposerText?: (text: string) => void;
  onClose: () => void;
  onCreateBranch: () => void;
  onOpenWorkspacePath: () => void;
  onRefreshDiff: () => void;
  onToggleReviewView: () => void;
}): React.ReactNode {
  const [scope, setScope] = React.useState<DesktopReviewScope>("unstaged");
  const [reviewDiff, setReviewDiff] = React.useState<Awaited<
    ReturnType<typeof desktopClient.getWorkspaceReviewDiff>
  > | null>(null);
  const [comments, setComments] = React.useState<DesktopReviewComment[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<CommentDraft | null>(null);

  const [hideFileList, setHideFileList] = React.useState(false);
  const [fileTreePanelWidth, setFileTreePanelWidth] = React.useState(
    REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH,
  );
  const [fileTreePanelResizing, setFileTreePanelResizing] =
    React.useState(false);
  const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedDiffPaths, setCollapsedDiffPaths] = React.useState<
    Set<string>
  >(() => new Set());
  const [scopeMenuOpen, setScopeMenuOpen] = React.useState(false);
  const [commitPopoverOpen, setCommitPopoverOpen] = React.useState(false);
  const [prPopoverOpen, setPrPopoverOpen] = React.useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = React.useState(false);
  const [wordWrap, setWordWrap] = React.useState(true);
  const [richDiffPreview, setRichDiffPreview] = React.useState(true);
  const [textDiff, setTextDiff] = React.useState(true);
  const [showWhitespace, setShowWhitespace] = React.useState(true);

  const commitButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const prButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const reviewMainRef = React.useRef<HTMLDivElement | null>(null);
  const diffScrollViewportRef = React.useRef<HTMLDivElement | null>(null);
  const diffFileSectionRefs = React.useRef(new Map<string, HTMLElement>());
  const fileSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const errorTimerRef = React.useRef<number | null>(null);
  const fileTreePanelResizeCleanupRef = React.useRef<(() => void) | null>(null);
  const resizeFrameRef = React.useRef<number | null>(null);
  const fileTreeResizePreviewRef = React.useRef<HTMLDivElement | null>(null);

  const refreshReviewDiff = React.useCallback(async () => {
    if (!workspacePath) {
      setReviewDiff(null);
      return;
    }
    try {
      setError(null);
      const result = await desktopClient.getWorkspaceReviewDiff({
        workspacePath,
        scope,
      });
      setReviewDiff(result);
    } catch (refreshError) {
      setError(errorMessageOf(refreshError));
    }
  }, [scope, workspacePath]);

  const refreshComments = React.useCallback(async () => {
    if (!activeSessionId) {
      setComments([]);
      return;
    }
    try {
      const snapshot = await desktopClient.getSession(activeSessionId);
      setComments(snapshot.reviewComments ?? []);
    } catch (refreshError) {
      setError(errorMessageOf(refreshError));
    }
  }, [activeSessionId]);

  React.useEffect(() => {
    void refreshReviewDiff();
  }, [refreshReviewDiff, isRefreshing]);

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
  const largeDiffMode = React.useMemo(
    () => countReviewDiffLines(visibleFiles) > 800,
    [visibleFiles],
  );
  const allCollapsed =
    visibleFiles.length > 0 &&
    visibleFiles.every((f) => collapsedDiffPaths.has(f.path));
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
    setCollapsedDiffPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function collapseAllDiffs(): void {
    setCollapsedDiffPaths(new Set(visibleFiles.map((f) => f.path)));
  }

  function expandAllDiffs(): void {
    setCollapsedDiffPaths(new Set());
  }

  async function applyOperation(
    action: "stage" | "unstage" | "revert",
    target:
      | { type: "file"; path: string }
      | { type: "hunk"; path: string; hunkId: string },
  ): Promise<void> {
    if (!workspacePath || pending) return;
    setPending(true);
    try {
      const result = await desktopClient.applyWorkspaceReviewOperation({
        workspacePath,
        scope,
        action,
        target,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setError(null);
      setReviewDiff(result.reviewDiff);
      onRefreshDiff();
    } catch (operationError) {
      setError(errorMessageOf(operationError));
    } finally {
      setPending(false);
    }
  }

  async function saveDraft(): Promise<void> {
    if (!activeSessionId || !draft || !draft.body.trim()) return;
    setPending(true);
    try {
      const snapshot = await desktopClient.saveSessionReviewComment({
        sessionId: activeSessionId,
        comment: {
          filePath: draft.filePath,
          side: draft.side,
          lineNumber: draft.lineNumber,
          lineContent: draft.lineContent,
          body: draft.body.trim(),
        },
      });
      setComments(snapshot.reviewComments ?? []);
      setDraft(null);
    } catch (commentError) {
      setError(errorMessageOf(commentError));
    } finally {
      setPending(false);
    }
  }

  async function resolveComment(commentId: string): Promise<void> {
    if (!activeSessionId) return;
    const snapshot = await desktopClient.resolveSessionReviewComment({
      sessionId: activeSessionId,
      commentId,
    });
    setComments(snapshot.reviewComments ?? []);
  }

  async function deleteComment(commentId: string): Promise<void> {
    if (!activeSessionId) return;
    const snapshot = await desktopClient.deleteSessionReviewComment({
      sessionId: activeSessionId,
      commentId,
    });
    setComments(snapshot.reviewComments ?? []);
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

  function sendReviewPromptToComposer(): void {
    if (!onAppendComposerText) return;
    onAppendComposerText(
      buildReviewComposerPrompt(
        reviewDiff?.status ?? gitStatus,
        reviewDiff?.files ?? [],
      ),
    );
  }

  function handleCommit(_message: string, _includeUnstaged: boolean): void {
    setCommitPopoverOpen(false);
    flashError("批量操作即将上线");
  }

  function handleCommitAndPush(
    _message: string,
    _includeUnstaged: boolean,
  ): void {
    setCommitPopoverOpen(false);
    flashError("批量操作即将上线");
  }

  function handlePush(): void {
    setCommitPopoverOpen(false);
    flashError("批量操作即将上线");
  }

  function handleCreateDraftPR(
    _title: string,
    _body: string,
    _pushFirst: boolean,
  ): void {
    setPrPopoverOpen(false);
    flashError("批量操作即将上线");
  }

  function handleCreatePR(
    _title: string,
    _body: string,
    _pushFirst: boolean,
  ): void {
    setPrPopoverOpen(false);
    flashError("批量操作即将上线");
  }

  function handleOpenPR(): void {
    setPrPopoverOpen(false);
    flashError("批量操作即将上线");
  }

  function handleLastTurnScope(): void {
    setScopeMenuOpen(false);
    flashError("批量操作即将上线");
  }

  function revertAll(): void {
    flashError("批量操作即将上线");
  }

  function stageAll(): void {
    flashError("批量操作即将上线");
  }

  function unstageAll(): void {
    flashError("批量操作即将上线");
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
    >
      <div className="review-sidebar-toolbar">
        <div className="review-sidebar-title">
          <PopoverMenu
            align="start"
            avoidCollisions={false}
            className="popover-review-scope"
            disableOutsideDismiss={debugMode}
            open={scopeMenuOpen}
            side="bottom"
            sideOffset={4}
            trigger={
              <button
                aria-label="切换变更范围"
                className="review-scope-trigger"
                type="button"
              >
                <span className="review-scope-trigger-label">
                  {scopeLabel(scope)}
                </span>
                <ChevronDown size={APP_ICON_SIZE} />
              </button>
            }
            onOpenChange={setScopeMenuOpen}
          >
            <PopoverItem
              selected={scope === "unstaged"}
              withCheck
              onClick={() => {
                setScope("unstaged");
                setScopeMenuOpen(false);
              }}
            >
              未暂存
            </PopoverItem>
            <PopoverItem
              selected={scope === "staged"}
              withCheck
              onClick={() => {
                setScope("staged");
                setScopeMenuOpen(false);
              }}
            >
              已暂存
            </PopoverItem>
            <PopoverItem
              icon={<GitCommitHorizontal size={APP_ICON_SIZE} />}
              onClick={() => {
                setScopeMenuOpen(false);
                setCommitPopoverOpen(true);
              }}
            >
              提交
            </PopoverItem>
            <PopoverItem
              icon={<GitFork size={APP_ICON_SIZE} />}
              onClick={() => {
                setScopeMenuOpen(false);
                onCreateBranch();
              }}
            >
              分支
            </PopoverItem>
            <PopoverItem withCheck onClick={handleLastTurnScope}>
              上轮对话
            </PopoverItem>
          </PopoverMenu>
          <span className="review-sidebar-counts">
            <strong>+{formatPanelNumber(totals.additions)}</strong>
            <em>-{formatPanelNumber(totals.deletions)}</em>
          </span>
        </div>
        <div className="review-sidebar-actions">
          <PopoverMenu
            align="end"
            className="popover-review-more"
            disableOutsideDismiss={debugMode}
            open={moreMenuOpen}
            sideOffset={4}
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
                void refreshReviewDiff();
                setMoreMenuOpen(false);
              }}
            >
              刷新变更
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
              <ChevronsUpDown size={APP_ICON_SIZE} />
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
              aria-label="审阅视图"
              className="message-action"
              type="button"
              onClick={onToggleReviewView}
            >
              {reviewView === "inline" ? (
                <Sliders
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : (
                <Columns2
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

      {error ? <div className="review-error-state">{error}</div> : null}

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
        {visibleFiles.length > 0 ? (
          <ReviewDiffPreview
            attachedComments={attachedComments}
            collapsedDiffPaths={collapsedDiffPaths}
            diffMarkerStyle={diffMarkerStyle}
            draft={draft}
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
          />
        ) : null}

        {!hideFileList ? (
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
                    {files.length === 0
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

      {!hideFileList && visibleFiles.length > 0 ? (
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

      <CommitPopover
        additions={totals.additions}
        anchorRef={commitButtonRef}
        branchName={gitStatus?.branchName ?? "HEAD"}
        deletions={totals.deletions}
        disableOutsideDismiss={debugMode}
        open={commitPopoverOpen}
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
  files,
  largeDiffMode,
  pending,
  scope,
  selectedPath,
  toggleCollapseDiff,
  viewportRef,
  view,
  workspacePath,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onFileSectionMount,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>;
  collapsedDiffPaths: Set<string>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  files: DesktopReviewDiffFile[];
  largeDiffMode: boolean;
  pending: boolean;
  scope: DesktopReviewScope;
  selectedPath: string | null;
  toggleCollapseDiff: (path: string) => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  view: DesktopReviewView;
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
        rootMargin: REVIEW_DIFF_LAZY_ROOT_MARGIN,
      },
    );

    for (const element of fileSectionElementsRef.current.values()) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [filePaths, viewportRef]);

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
      >
        {files.map((file) => (
          <ReviewDiffFilePreview
            active={file.path === selectedPath}
            attachedComments={attachedComments}
            collapsedDiffPaths={collapsedDiffPaths}
            diffMarkerStyle={diffMarkerStyle}
            draft={draft}
            file={file}
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
            view={view}
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
  largeDiffMode,
  pending,
  previewHeight,
  renderBody,
  scope,
  sectionRef,
  toggleCollapseDiff,
  view,
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
  largeDiffMode: boolean;
  pending: boolean;
  previewHeight: number;
  renderBody: boolean;
  scope: DesktopReviewScope;
  sectionRef: (element: HTMLElement | null) => void;
  toggleCollapseDiff: (path: string) => void;
  view: DesktopReviewView;
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

  const virtualize = React.useMemo(() => {
    if (!renderBody || isCollapsed || !hasContent) return false;
    const totalLines = file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
    return largeDiffMode || totalLines > 500;
  }, [renderBody, isCollapsed, hasContent, file.hunks, largeDiffMode]);

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
        <span className="review-file-collapse-chevron">
          {isCollapsed ? (
            <ChevronRight size={APP_ICON_SIZE} />
          ) : (
            <ChevronDown size={APP_ICON_SIZE} />
          )}
        </span>
        <span className="review-file-badge">{fileBadge(file.path)}</span>
        <span className="review-file-path">{file.path}</span>
        <span className="review-file-counts">
          <strong>+{formatPanelNumber(file.additions)}</strong>
          <em>-{formatPanelNumber(file.deletions)}</em>
        </span>
        <div
          className="review-file-actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="toolbar"
          aria-label="文件操作"
        >
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
                <Upload size={APP_ICON_SIZE} />
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
                <Undo2 size={APP_ICON_SIZE} />
              </button>
            </Tooltip>
          )}
          {scope === "unstaged" ? (
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
                <Trash2 size={APP_ICON_SIZE} />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content="在文件管理器中打开">
            <button
              aria-label="在文件管理器中打开"
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
              <FileDiff size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
        </div>
      </div>
      {diffBody}
    </section>
  );
}

/* ── Virtual-scroll row renderers ──────────────────────────── */

function VirtualDiffInlineRow({
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  line,
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
      <div className={`review-diff-row ${line.type}`}>
        <LineCommentButton
          anchor={anchor}
          disabled={!anchor}
          onCreateDraft={onCreateDraft}
        />
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
        <code className="review-diff-line-content">{line.content || " "}</code>
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
  onCancelDraft: () => void;
  onCreateDraft: (draft: CommentDraft) => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  return (
    <div className="review-diff-vlist-row">
      <div className="review-diff-split-row paired">
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
              className={`review-diff-side ${cell.tone}`}
              data-tone={cell.tone}
              key={cell.side}
            >
              <LineCommentButton
                anchor={anchor}
                disabled={!anchor}
                onCreateDraft={onCreateDraft}
              />
              <span
                className={`review-diff-line-number ${
                  cell.tone === "added"
                    ? "added"
                    : cell.tone === "removed"
                      ? "removed"
                      : ""
                }`}
              >
                {cell.number ?? ""}
              </span>
              <DiffMarker tone={cell.tone} />
              <code className="review-diff-line-content">
                {cell.tone === "empty" ? " " : cell.content || " "}
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
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: ReviewDiffBodyProps): React.ReactNode {
  return (
    <div
      className={`review-diff-lines-scroll-x review-diff-inline marker-${diffMarkerStyle}`}
    >
      <div className="review-diff-lines">
        {file.hunks.map((hunk) => (
          <React.Fragment key={hunk.id}>
            <ReviewHunkHeader
              file={file}
              hunk={hunk}
              pending={pending}
              scope={scope}
              onApplyOperation={onApplyOperation}
            />
            {hunk.lines.map((line) => {
              const side = line.type === "removed" ? "left" : "right";
              const lineNumber =
                line.type === "removed" ? line.oldLine : line.newLine;
              const anchor = buildAnchor(
                file.path,
                side,
                lineNumber,
                line.content,
              );
              const comments = anchor
                ? (attachedComments.get(commentKey(anchor)) ?? [])
                : [];
              return (
                <div className={`review-diff-row ${line.type}`} key={line.id}>
                  <LineCommentButton
                    anchor={anchor}
                    disabled={!anchor}
                    onCreateDraft={onCreateDraft}
                  />
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
                    {line.content || " "}
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
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function ReviewDiffSplit({
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  pending,
  scope,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: ReviewDiffBodyProps): React.ReactNode {
  return (
    <div
      className={`review-diff-lines-scroll-x review-diff-split marker-${diffMarkerStyle}`}
    >
      <div className="review-diff-lines">
        {file.hunks.map((hunk) => (
          <React.Fragment key={hunk.id}>
            <ReviewHunkHeader
              file={file}
              hunk={hunk}
              pending={pending}
              scope={scope}
              onApplyOperation={onApplyOperation}
            />
            {splitDiffLines(hunk.lines).map((row) => (
              <div
                className={`review-diff-split-row ${
                  row.paired ? "paired" : "single"
                }`}
                key={row.id}
              >
                {[row.left, row.right].map((cell) => {
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
                      className={`review-diff-side ${cell.tone}`}
                      data-tone={cell.tone}
                      key={cell.side}
                    >
                      <LineCommentButton
                        anchor={anchor}
                        disabled={!anchor}
                        onCreateDraft={onCreateDraft}
                      />
                      <span
                        className={`review-diff-line-number ${
                          cell.tone === "added"
                            ? "added"
                            : cell.tone === "removed"
                              ? "removed"
                              : ""
                        }`}
                      >
                        {cell.number ?? ""}
                      </span>
                      <DiffMarker tone={cell.tone} />
                      <code className="review-diff-line-content">
                        {cell.tone === "empty" ? " " : cell.content || " "}
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
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

type ReviewDiffBodyProps = {
  attachedComments: Map<string, DesktopReviewComment[]>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  pending: boolean;
  scope: DesktopReviewScope;
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
    <span className={`review-diff-marker ${tone}`} aria-hidden="true">
      {tone === "added" ? "+" : tone === "removed" ? "-" : ""}
    </span>
  );
}

function ReviewHunkHeader({
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
    <div className="review-diff-row hunk">
      <span className="review-diff-line-content">{hunk.header}</span>
      <div className="review-hunk-actions">
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
  if (value > 999) return "999+";
  return String(value);
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
