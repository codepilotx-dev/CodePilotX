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
} from "../../../../shared/types.js";
import {
  desktopClient,
  WORKSPACE_GIT_CHANGED_EVENT,
} from "../../../services/desktop-client/index.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { buildPopoverSizingStyle } from "../../../components/ui/popoverSizing.js";
import { ScrollArea } from "../../../components/ui/ScrollArea.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { buildReviewFileTree } from "../workspace/buildReviewFileTree.js";
import { buildCommentCountsByPath } from "../comments/reviewCommentUtils.js";
import { CommitPopover } from "../workspace/CommitPopover.js";
import { PullRequestPopover } from "../workspace/PullRequestPopover.js";
import { ReviewFileTreeNode } from "../workspace/ReviewFileTree.js";
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
  reviewSourceLabel,
  summaryFileToDesktop,
  type ReviewBranch,
  type ReviewCommit,
  type ReviewFileDiff,
  type ReviewLoadState,
  type ReviewSummarySnapshot,
} from "../source/reviewAgentClient.js";

export type ReviewFilter = "all" | "added" | "modified" | "removed";

export type ReviewDisplayPath = {
  directory: string;
  fileName: string;
};

export type ReviewFileLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "error"; message: string };

export type CommentAnchor = {
  filePath: string;
  side: DesktopReviewSide;
  lineNumber: number;
  lineContent: string;
};

export type CommentDraft = CommentAnchor & {
  body: string;
};

export type ReviewSplitRow = {
  id: string;
  left: ReviewCell;
  right: ReviewCell;
  paired: boolean;
};

export type ReviewCell = {
  line: DesktopReviewDiffLine | null;
  side: DesktopReviewSide;
  number: number | null;
  content: string;
  tone: "removed" | "added" | "context" | "meta" | "empty";
};

export type CodexDiffPaneRow =
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

export type ReviewSyntaxByLineId = ReadonlyMap<string, readonly SyntaxToken[]>;

export const REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH = 340;
export const REVIEW_FILE_TREE_PANEL_MIN_WIDTH = 240;
export const REVIEW_FILE_TREE_PANEL_MAX_WIDTH = 520;
export const REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP = 24;
export const REVIEW_DIFF_PREVIEW_MIN_WIDTH = 260;
export const REVIEW_FILE_ACTION_ICON_SIZE = 12;
export const ListChevronsDownUp = createLucideIcon("list-chevrons-down-up", [
  ["path", { d: "M3 5h8", key: "18g2rq" }],
  ["path", { d: "M3 12h8", key: "1xfjp6" }],
  ["path", { d: "M3 19h8", key: "fpbke4" }],
  ["path", { d: "m15 5 3 3 3-3", key: "1t4thf" }],
  ["path", { d: "m15 19 3-3 3 3", key: "y4ckd2" }],
]);
export const ListChevronsUpDown = createLucideIcon("list-chevrons-up-down", [
  ["path", { d: "M3 5h8", key: "18g2rq" }],
  ["path", { d: "M3 12h8", key: "1xfjp6" }],
  ["path", { d: "M3 19h8", key: "fpbke4" }],
  ["path", { d: "m15 8 3-3 3 3", key: "bc4io6" }],
  ["path", { d: "m15 16 3 3 3-3", key: "9wmg1l" }],
]);
export const FILE_HEADER_HEIGHT = 32;
export const HUNK_HEADER_HEIGHT = 28;
export const DIFF_LINE_HEIGHT = 22;
export const EMPTY_FILE_MIN_HEIGHT = 64;

export function estimateFilePreviewHeight(file: DesktopReviewDiffFile): number {
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

export function countReviewDiffLines(files: DesktopReviewDiffFile[]): number {
  let total = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      total += hunk.lines.length;
    }
  }
  return total;
}

export function splitReviewDisplayPath(path: string): ReviewDisplayPath {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator < 0
    ? { directory: "", fileName: path }
    : {
        directory: path.slice(0, separator + 1),
        fileName: path.slice(separator + 1),
      };
}

/* ── Virtual-scroll flatten helpers ─────────────────────────── */

export type DiffVirtualRow =
  | {
      kind: "hunk-header";
      hunk: DesktopReviewDiffHunk;
      unmodifiedLines: number;
    }
  | { kind: "inline-line"; line: DesktopReviewDiffLine }
  | { kind: "split-row"; left: ReviewCell; right: ReviewCell; rowId: string };

export function flattenDiffRows(
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

export function countUnmodifiedLinesBeforeHunk(
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

export function formatUnmodifiedLines(count: number): string {
  return `${count.toLocaleString("en-US")} unmodified ${
    count === 1 ? "line" : "lines"
  }`;
}


export function ReviewDiffPreview({
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

export function ReviewDiffFilePreview({
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
        <FileIcon
          aria-hidden="true"
          className="review-file-icon"
          path={file.path}
          size={APP_ICON_SIZE}
        />
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

export function ReviewVirtualDiffRows({
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

export function VirtualDiffInlineRow({
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

export function VirtualDiffSplitRow({
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

export function ReviewDiffInline({
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

export function ReviewDiffSplit({
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

export function ReviewDiffCodePane({
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

export function buildUnifiedDiffRows(file: DesktopReviewDiffFile): CodexDiffPaneRow[] {
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

export function useReviewDiffSyntax(
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

export function ReviewSyntaxText({
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

export function buildSplitDiffRows(file: DesktopReviewDiffFile): {
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

export function codexDiffLineType(cell: ReviewCell["tone"]): string {
  if (cell === "added") return "change-addition";
  if (cell === "removed") return "change-deletion";
  if (cell === "empty") return "buffer";
  if (cell === "meta") return "metadata";
  return "context";
}

export function useSyncCodexSplitRows(
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

export type ReviewDiffBodyProps = {
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

export function DiffMarker({
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

export function ReviewHunkHeader({
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

export function ReviewHunkActions({
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

export function LineCommentButton({
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

export function LineComments({
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

export function ReviewComment({
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

export function splitDiffLines(lines: DesktopReviewDiffLine[]): ReviewSplitRow[] {
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

export function emptyCell(side: DesktopReviewSide): ReviewCell {
  return {
    line: null,
    side,
    number: null,
    content: "",
    tone: "empty",
  };
}

export function clampReviewFileTreePanelWidth(
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

export function attachComments(
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

export function buildAnchor(
  filePath: string,
  side: DesktopReviewSide,
  lineNumber: number | null,
  lineContent: string,
): CommentAnchor | null {
  if (lineNumber === null) return null;
  return { filePath, side, lineNumber, lineContent };
}

export function commentKey(anchor: CommentAnchor): string {
  return `${anchor.filePath}\u0000${anchor.side}\u0000${anchor.lineNumber}\u0000${anchor.lineContent}`;
}

export function filterStatusForFile(file: DesktopReviewDiffFile): ReviewFilter {
  if (file.isUntracked) return "added";
  const trimmed = file.status.trim();
  if (trimmed.startsWith("A") || trimmed.startsWith("??")) return "added";
  if (trimmed.startsWith("D")) return "removed";
  return "modified";
}

export function reviewFilterLabel(filter: ReviewFilter): string {
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

export function ReviewCommitSourceSubmenu({
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
          className="popover-surface popover popover-sub-content popover-review-commits popover-menu--flex"
          sideOffset={16}
          style={buildPopoverSizingStyle({ width: 320 })}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export function ReviewProjectEmptyState({
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

export function formatRelativeCommitTime(value: string): string {
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

export function scopeLabel(scope: DesktopReviewScope): string {
  switch (scope) {
    case "staged":
      return "已暂存";
    default:
      return "未暂存";
  }
}

export function formatPanelNumber(value: number): string {
  return formatReviewCount(value);
}

export function buildReviewComposerPrompt(
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

export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseGithubPullRequestUrl(
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

export async function copyGitApplyCommand(
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
