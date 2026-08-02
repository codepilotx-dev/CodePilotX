import React from "react";
import { FileIcon } from "@codepilotx/material-icon-theme";
import { VList } from "virtua";
import {
  Briefcase,
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
import { ScrollArea } from "../../../components/ui/ScrollArea.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { buildCommentCountsByPath } from "../comments/reviewCommentUtils.js";
import { CommitPopover } from "../workspace/CommitPopover.js";
import { PullRequestPopover } from "../workspace/PullRequestPopover.js";
import { formatReviewCount } from "../diff/reviewFormat.js";
import {
  isReviewDiffExpanded,
  toggleReviewDiffExpansion,
  type ReviewTabUiState,
} from "../../layout/tabs/conversationUiState.js";
import {
  buildReviewIntralineByLineId,
  type ReviewIntralineByLineId,
} from "./reviewIntralineDiff.js";
import {
  ReviewDiffInline,
  ReviewDiffLineContent,
  ReviewDiffLineNumber,
  ReviewDiffSplit,
  ReviewHunkActions,
  ReviewSyntaxText,
  buildAnchor,
  commentKey,
  countUnmodifiedLinesBeforeHunk,
  formatUnmodifiedLines,
  splitDiffLines,
  useReviewDiffSyntax,
  type CommentAnchor,
  type CommentDraft,
  type ReviewCell,
  type ReviewSyntaxByLineId,
} from "./ReviewDiffSurface.js";
export {
  ReviewComment,
  type CommentAnchor,
  type CommentDraft,
} from "./ReviewDiffSurface.js";
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

export type ReviewDisplayPath = {
  directory: string;
  fileName: string;
};

export type ReviewFileLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "error"; message: string };

export function reviewFileLoadMessage(
  fileLoadState: ReviewFileLoadState,
  summaryLoadState: ReviewLoadState,
): string | null {
  if (fileLoadState.status === "loading") return "正在加载文件差异…";
  if (fileLoadState.status !== "idle") return null;
  if (summaryLoadState === "loading" || summaryLoadState === "stale") {
    return "正在刷新变更快照…";
  }
  if (summaryLoadState === "error") {
    return "变更快照加载失败，请使用上方重试。";
  }
  return "等待加载文件差异…";
}

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
export const FILE_HEADER_HEIGHT = 38;
export const HUNK_HEADER_HEIGHT = 28;
export const DIFF_LINE_HEIGHT = 22;
export const EMPTY_FILE_MIN_HEIGHT = 64;
export const REVIEW_FILE_VIRTUALIZE_LINE_THRESHOLD = 800;

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

export const ReviewDiffPreview = React.memo(function ReviewDiffPreview({
  attachedComments,
  collapsedDiffPaths,
  diffMarkerStyle,
  draft,
  fileLoadStates,
  files,
  largeWorkspaceMode,
  pending,
  summaryLoadState,
  scope,
  selectedPath,
  toggleCollapseDiff,
  viewportRef,
  view,
  showWordDiff,
  wrapLines,
  workspacePath,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onFileSectionMount,
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
  largeWorkspaceMode: boolean;
  pending: boolean;
  summaryLoadState: ReviewLoadState;
  scope: DesktopReviewScope;
  selectedPath: string | null;
  toggleCollapseDiff: (path: string) => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  view: DesktopReviewView;
  showWordDiff: boolean;
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
      <div className="review-diff-preview-content">
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
              largeWorkspaceMode={largeWorkspaceMode}
              pending={pending}
              summaryLoadState={summaryLoadState}
              previewHeight={estimateFilePreviewHeight(file)}
              renderBody={
                file.path === selectedPath || windowedPaths.has(file.path)
              }
              scope={scope}
              sectionRef={setFileSectionElement(file.path)}
              toggleCollapseDiff={toggleCollapseDiff}
              onRetryFile={onRetryFile}
              view={view}
              showWordDiff={showWordDiff}
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
      </div>
    </section>
  );
}, (previous, next) =>
  previous.attachedComments === next.attachedComments &&
  previous.collapsedDiffPaths === next.collapsedDiffPaths &&
  previous.diffMarkerStyle === next.diffMarkerStyle &&
  previous.draft === next.draft &&
  previous.fileLoadStates === next.fileLoadStates &&
  previous.files === next.files &&
  previous.largeWorkspaceMode === next.largeWorkspaceMode &&
  previous.pending === next.pending &&
  previous.summaryLoadState === next.summaryLoadState &&
  previous.scope === next.scope &&
  previous.selectedPath === next.selectedPath &&
  previous.viewportRef === next.viewportRef &&
  previous.view === next.view &&
  previous.showWordDiff === next.showWordDiff &&
  previous.wrapLines === next.wrapLines &&
  previous.workspacePath === next.workspacePath
);

export function shouldVirtualizeReviewFile(
  file: DesktopReviewDiffFile,
): boolean {
  return (
    countReviewDiffLines([file]) > REVIEW_FILE_VIRTUALIZE_LINE_THRESHOLD
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
  largeWorkspaceMode,
  pending,
  summaryLoadState,
  previewHeight,
  renderBody,
  scope,
  sectionRef,
  onRetryFile,
  toggleCollapseDiff,
  view,
  showWordDiff,
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
  largeWorkspaceMode: boolean;
  pending: boolean;
  summaryLoadState: ReviewLoadState;
  previewHeight: number;
  renderBody: boolean;
  scope: DesktopReviewScope;
  sectionRef: (element: HTMLElement | null) => void;
  onRetryFile: (path: string) => void;
  toggleCollapseDiff: (path: string) => void;
  view: DesktopReviewView;
  showWordDiff: boolean;
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
    return shouldVirtualizeReviewFile(file);
  }, [renderBody, isCollapsed, hasContent, file]);

  const flattenedRows = React.useMemo(
    () => (virtualize ? flattenDiffRows(file, view) : []),
    [virtualize, file, view],
  );
  const intralineByLineId = React.useMemo(
    () =>
      buildReviewIntralineByLineId(file.hunks, {
        enabled: showWordDiff,
      }),
    [file.hunks, showWordDiff],
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
          largeWorkspaceMode
            ? "review-diff-virtual-body fill-space"
            : "review-diff-virtual-body"
        }
        style={
          !largeWorkspaceMode
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
          intralineByLineId={intralineByLineId}
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
  } else if (fileLoadState.status === "loading") {
    diffBody = (
      <div className="review-empty-state review-file-load-state" role="status">
        {reviewFileLoadMessage(fileLoadState, summaryLoadState)}
      </div>
    );
  } else if (fileLoadState.status === "idle") {
    diffBody = (
      <div className="review-empty-state review-file-load-state" role="status">
        {reviewFileLoadMessage(fileLoadState, summaryLoadState)}
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
        intralineByLineId={intralineByLineId}
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
        intralineByLineId={intralineByLineId}
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
        virtualize && largeWorkspaceMode
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
          associationMode="extension-only"
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
              aria-disabled={!workspacePath}
              className="message-action review-file-open"
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
              aria-disabled={pending}
              className="message-action"
              type="button"
              onClick={() => {
                if (pending) return;
                onApplyOperation("revert", { type: "file", path: file.path });
              }}
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
                aria-disabled={pending}
                className="message-action"
                type="button"
                onClick={() => {
                  if (pending) return;
                  onApplyOperation("stage", { type: "file", path: file.path });
                }}
              >
                <Plus size={REVIEW_FILE_ACTION_ICON_SIZE} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="取消暂存文件">
              <button
                aria-label="取消暂存文件"
                aria-disabled={pending}
                className="message-action"
                type="button"
                onClick={() => {
                  if (pending) return;
                  onApplyOperation("unstage", { type: "file", path: file.path });
                }}
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
  intralineByLineId,
  pending,
  scope,
  view,
  readOnly = false,
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
  intralineByLineId: ReviewIntralineByLineId;
  pending: boolean;
  scope: DesktopReviewScope;
  view: DesktopReviewView;
  readOnly?: boolean;
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
  const syntax = useReviewDiffSyntax(file);

  return (
    <div
      className="review-codex-diff review-codex-diff--virtual"
      data-diff=""
      data-diff-type={view === "split" ? "split" : "single"}
      data-indicators={diffMarkerStyle === "symbol" ? "classic" : "bars"}
      data-overflow="scroll"
      data-review-syntax-state={syntax.state}
    >
      <VList
        bufferSize={64}
        className="review-diff-vlist"
        data={flattenedRows}
        itemSize={20}
        style={{ width: "100%", height: "100%" }}
      >
        {(row) =>
          row.kind === "hunk-header" ? (
            <VirtualDiffHunkRow
              file={file}
              hunk={row.hunk}
              key={`hunk-${row.hunk.id}`}
              pending={pending}
              readOnly={readOnly}
              scope={scope}
              unmodifiedLines={row.unmodifiedLines}
              onApplyOperation={onApplyOperation}
            />
          ) : view === "split" && row.kind === "split-row" ? (
            <VirtualDiffSplitRow
              key={row.rowId}
              attachedComments={attachedComments}
              draft={draft}
              file={file}
              left={row.left}
              right={row.right}
              intralineByLineId={intralineByLineId}
              syntaxByLineId={syntax.byLineId}
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
              draft={draft}
              file={file}
              line={row.line}
              intralineByLineId={intralineByLineId}
              readOnly={readOnly}
              syntaxByLineId={syntax.byLineId}
              onCancelDraft={onCancelDraft}
              onCreateDraft={onCreateDraft}
              onDeleteComment={onDeleteComment}
              onDraftBodyChange={onDraftBodyChange}
              onResolveComment={onResolveComment}
              onSaveDraft={onSaveDraft}
            />
          ) : null
        }
      </VList>
    </div>
  );
}

export function VirtualDiffHunkRow({
  file,
  hunk,
  unmodifiedLines,
  pending,
  scope,
  readOnly = false,
  onApplyOperation,
}: {
  file: DesktopReviewDiffFile;
  hunk: DesktopReviewDiffHunk;
  unmodifiedLines: number;
  pending: boolean;
  scope: DesktopReviewScope;
  readOnly?: boolean;
  onApplyOperation: (
    action: "stage" | "unstage" | "revert",
    target: { type: "hunk"; path: string; hunkId: string },
  ) => void;
}): React.ReactNode {
  return (
    <div
      className="review-codex-diff__virtual-row"
      data-virtual-layout="hunk"
    >
      <div
        className="review-codex-diff__hunk review-codex-diff__hunk--gutter"
        data-separator="line-info"
      />
      <div
        className="review-codex-diff__hunk review-codex-diff__hunk--content"
        data-separator="line-info"
      >
        <div data-separator-wrapper="">
          <span data-separator-content="">
            {formatUnmodifiedLines(unmodifiedLines)}
          </span>
          {readOnly ? null : (
            <ReviewHunkActions
              file={file}
              hunk={hunk}
              pending={pending}
              scope={scope}
              onApplyOperation={onApplyOperation}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function VirtualDiffInlineRow({
  attachedComments,
  draft,
  file,
  line,
  intralineByLineId,
  syntaxByLineId,
  readOnly = false,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  line: DesktopReviewDiffLine;
  intralineByLineId: ReviewIntralineByLineId;
  syntaxByLineId: ReviewSyntaxByLineId;
  readOnly?: boolean;
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
    <div
      className="review-codex-diff__virtual-row"
      data-virtual-layout="single"
    >
      <ReviewDiffLineNumber
        anchor={readOnly ? null : anchor}
        cellTone={line.type}
        lineNumber={lineNumber}
        readOnly={readOnly}
        onCreateDraft={onCreateDraft}
      />
      <ReviewDiffLineContent
        anchor={readOnly ? null : anchor}
        comments={readOnly ? [] : comments}
        draft={readOnly ? null : draft}
        cellTone={line.type}
        readOnly={readOnly}
        onCancelDraft={onCancelDraft}
        onDeleteComment={onDeleteComment}
        onDraftBodyChange={onDraftBodyChange}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      >
        <span className="review-codex-diff__line-text">
          <ReviewSyntaxText
            content={line.content}
            line={line}
            ranges={intralineByLineId.get(line.id)}
            syntaxByLineId={syntaxByLineId}
          />
        </span>
      </ReviewDiffLineContent>
    </div>
  );
}

export function VirtualDiffSplitRow({
  attachedComments,
  draft,
  file,
  left,
  right,
  intralineByLineId,
  syntaxByLineId,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  left: ReviewCell;
  right: ReviewCell;
  intralineByLineId: ReviewIntralineByLineId;
  syntaxByLineId: ReviewSyntaxByLineId;
  onCancelDraft: () => void;
  onCreateDraft: (draft: CommentDraft) => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  return (
    <div
      className="review-codex-diff__virtual-row"
      data-virtual-layout="split"
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
              className="review-codex-diff__virtual-cell"
              key={cell.side}
            >
              <ReviewDiffLineNumber
                anchor={anchor}
                cellTone={cell.tone}
                lineNumber={cell.number}
                onCreateDraft={onCreateDraft}
              />
              <ReviewDiffLineContent
                anchor={anchor}
                comments={comments}
                draft={draft}
                cellTone={cell.tone}
                onCancelDraft={onCancelDraft}
                onDeleteComment={onDeleteComment}
                onDraftBodyChange={onDraftBodyChange}
                onResolveComment={onResolveComment}
                onSaveDraft={onSaveDraft}
              >
                <span className="review-codex-diff__line-text">
                {cell.tone === "empty" ? (
                  " "
                ) : (
                  <ReviewSyntaxText
                    content={cell.content}
                    line={cell.line}
                    ranges={
                      cell.line
                        ? intralineByLineId.get(cell.line.id)
                        : undefined
                    }
                    syntaxByLineId={syntaxByLineId}
                  />
                )}
                </span>
              </ReviewDiffLineContent>
            </div>
          );
        })}
    </div>
  );
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
