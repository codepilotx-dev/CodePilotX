import React from "react";
import {
  CheckCircle2,
  MessageSquarePlus,
  Trash2,
} from "lucide-react";
import type {
  DesktopDiffMarkerStyle,
  DesktopReviewComment,
  DesktopReviewDiffFile,
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
  DesktopReviewScope,
  DesktopReviewSide,
} from "../../../../shared/types.js";
import { syntaxTokenStyle } from "../../syntax/CodeBlock.js";
import {
  normalizeSyntaxLanguage,
  resolveLanguageFromPath,
} from "../../syntax/language.js";
import {
  CODEX_HIGHLIGHT_THEMES,
  resolveThemeId,
} from "../../syntax/theme.js";
import type { SyntaxToken } from "../../syntax/types.js";
import { useHighlightedCode } from "../../syntax/useHighlightedCode.js";
import { useDesktopTheme } from "../../theme/themeContext.js";
import {
  alignReviewDiffLines,
  buildReviewIntralineByLineId,
  type ReviewIntralineByLineId,
  type ReviewIntralineRange,
} from "./reviewIntralineDiff.js";

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

export type ReviewSyntaxByLineId = ReadonlyMap<
  string,
  readonly SyntaxToken[]
>;
export type ReviewDiffSyntaxState = "loading" | "ready" | "plain";
export type ReviewDiffSyntax = {
  byLineId: ReviewSyntaxByLineId;
  state: ReviewDiffSyntaxState;
};

export type ReviewDiffBodyProps = {
  attachedComments: Map<string, DesktopReviewComment[]>;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  draft: CommentDraft | null;
  file: DesktopReviewDiffFile;
  intralineByLineId: ReviewIntralineByLineId;
  pending: boolean;
  scope: DesktopReviewScope;
  syntaxThemeId?: string;
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

export type ReviewDiffReadOnlySplitProps = {
  file: DesktopReviewDiffFile;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  syntaxThemeId?: string;
  showWordDiff: boolean;
  wrapLines: boolean;
  ariaLabel: string;
};

export type ReviewDiffReadOnlyInlineProps = Omit<
  ReviewDiffReadOnlySplitProps,
  "ariaLabel"
> & {
  ariaLabel?: string;
};

const EMPTY_COMMENTS = new Map<string, DesktopReviewComment[]>();
const NOOP = (): void => {};
const NOOP_DRAFT = (_draft: CommentDraft): void => {};
const NOOP_OPERATION = (
  _action: "stage" | "unstage" | "revert",
  _target:
    | { type: "file"; path: string }
    | { type: "hunk"; path: string; hunkId: string },
): void => {};

export function ReviewDiffReadOnlySplit({
  file,
  diffMarkerStyle,
  syntaxThemeId,
  showWordDiff,
  wrapLines,
  ariaLabel,
}: ReviewDiffReadOnlySplitProps): React.ReactNode {
  const intralineByLineId = React.useMemo(
    () =>
      buildReviewIntralineByLineId(file.hunks, {
        enabled: showWordDiff,
      }),
    [file.hunks, showWordDiff],
  );

  return (
    <ReviewDiffSplit
      ariaLabel={ariaLabel}
      attachedComments={EMPTY_COMMENTS}
      diffMarkerStyle={diffMarkerStyle}
      draft={null}
      file={file}
      intralineByLineId={intralineByLineId}
      pending={false}
      readOnly
      scope="unstaged"
      syntaxThemeId={syntaxThemeId}
      wrapLines={wrapLines}
      onApplyOperation={NOOP_OPERATION}
      onCancelDraft={NOOP}
      onCreateDraft={NOOP_DRAFT}
      onDeleteComment={NOOP}
      onDraftBodyChange={NOOP}
      onResolveComment={NOOP}
      onSaveDraft={NOOP}
    />
  );
}

export function ReviewDiffReadOnlyInline({
  file,
  diffMarkerStyle,
  syntaxThemeId,
  showWordDiff,
  wrapLines,
  ariaLabel,
}: ReviewDiffReadOnlyInlineProps): React.ReactNode {
  const intralineByLineId = React.useMemo(
    () =>
      buildReviewIntralineByLineId(file.hunks, {
        enabled: showWordDiff,
      }),
    [file.hunks, showWordDiff],
  );

  return (
    <ReviewDiffInline
      ariaLabel={ariaLabel}
      attachedComments={EMPTY_COMMENTS}
      diffMarkerStyle={diffMarkerStyle}
      draft={null}
      file={file}
      intralineByLineId={intralineByLineId}
      pending={false}
      readOnly
      scope="unstaged"
      syntaxThemeId={syntaxThemeId}
      wrapLines={wrapLines}
      onApplyOperation={NOOP_OPERATION}
      onCancelDraft={NOOP}
      onCreateDraft={NOOP_DRAFT}
      onDeleteComment={NOOP}
      onDraftBodyChange={NOOP}
      onResolveComment={NOOP}
      onSaveDraft={NOOP}
    />
  );
}

export function ReviewDiffInline({
  ariaLabel,
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  intralineByLineId,
  pending,
  scope,
  syntaxThemeId,
  wrapLines,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
  readOnly = false,
}: ReviewDiffBodyProps & {
  ariaLabel?: string;
  readOnly?: boolean;
}): React.ReactNode {
  const rows = buildUnifiedDiffRows(file);
  const syntax = useReviewDiffSyntax(file, syntaxThemeId);
  return (
    <pre
      aria-label={ariaLabel}
      className="review-codex-diff"
      data-diff=""
      data-diff-type="single"
      data-indicators={diffMarkerStyle === "symbol" ? "classic" : "bars"}
      data-overflow={wrapLines ? "wrap" : "scroll"}
      data-review-syntax-state={syntax.state}
    >
      <ReviewDiffCodePane
        attachedComments={attachedComments}
        draft={draft}
        file={file}
        intralineByLineId={intralineByLineId}
        pane="unified"
        pending={pending}
        readOnly={readOnly}
        rows={rows}
        scope={scope}
        syntaxByLineId={syntax.byLineId}
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
  ariaLabel,
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  intralineByLineId,
  pending,
  readOnly = false,
  scope,
  syntaxThemeId,
  wrapLines,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: ReviewDiffBodyProps & {
  ariaLabel?: string;
  readOnly?: boolean;
}): React.ReactNode {
  const rootRef = React.useRef<HTMLPreElement>(null);
  const { leftRows, rightRows } = React.useMemo(
    () => buildSplitDiffRows(file),
    [file],
  );
  const syntax = useReviewDiffSyntax(file, syntaxThemeId);
  useSyncCodexSplitRows(rootRef, !wrapLines, file);

  return (
    <pre
      aria-label={ariaLabel}
      className="review-codex-diff"
      data-diff=""
      data-diff-type="split"
      data-indicators={diffMarkerStyle === "symbol" ? "classic" : "bars"}
      data-overflow={wrapLines ? "wrap" : "scroll"}
      data-review-syntax-state={syntax.state}
      ref={rootRef}
    >
      <ReviewDiffCodePane
        attachedComments={attachedComments}
        draft={draft}
        file={file}
        intralineByLineId={intralineByLineId}
        pane="deletions"
        pending={pending}
        readOnly={readOnly}
        rows={leftRows}
        scope={scope}
        syncRows={!wrapLines}
        syntaxByLineId={syntax.byLineId}
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
        intralineByLineId={intralineByLineId}
        pane="additions"
        pending={pending}
        readOnly={readOnly}
        rows={rightRows}
        scope={scope}
        syncRows={!wrapLines}
        syntaxByLineId={syntax.byLineId}
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
  intralineByLineId,
  pane,
  pending,
  readOnly = false,
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
}: Omit<
  ReviewDiffBodyProps,
  "diffMarkerStyle" | "syntaxThemeId" | "wrapLines"
> & {
  pane: "unified" | "deletions" | "additions";
  readOnly?: boolean;
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
      <div
        className="review-codex-diff__gutter"
        data-gutter=""
        style={columnStyle}
      >
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
            <ReviewDiffLineNumber
              anchor={anchor}
              cellTone={cell.tone}
              key={`gutter-${row.id}`}
              lineNumber={cell.number}
              readOnly={readOnly}
              syncRow={syncRows ? row.id : undefined}
              onCreateDraft={onCreateDraft}
            />
          );
        })}
      </div>

      <div
        className="review-codex-diff__content"
        data-content=""
        style={columnStyle}
      >
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
                  {readOnly || pane === "additions" ? null : (
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
          const comments =
            !readOnly && anchor
              ? (attachedComments.get(commentKey(anchor)) ?? [])
              : [];
          return (
            <ReviewDiffLineContent
              anchor={anchor}
              cellTone={cell.tone}
              comments={comments}
              draft={readOnly ? null : draft}
              key={`content-${row.id}`}
              readOnly={readOnly}
              syncRow={syncRows ? row.id : undefined}
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
          );
        })}
      </div>
    </code>
  );
}

export function ReviewDiffLineNumber({
  anchor,
  cellTone,
  lineNumber,
  readOnly = false,
  syncRow,
  onCreateDraft,
}: {
  anchor: CommentAnchor | null;
  cellTone: ReviewCell["tone"];
  lineNumber: number | null;
  readOnly?: boolean;
  syncRow?: string;
  onCreateDraft: (draft: CommentDraft) => void;
}): React.ReactNode {
  return (
    <div
      className="review-codex-diff__number"
      data-column-number={lineNumber ?? ""}
      data-diff-sync-row={syncRow}
      data-line-type={codexDiffLineType(cellTone)}
    >
      {readOnly ? null : (
        <LineCommentButton
          anchor={anchor}
          disabled={!anchor}
          onCreateDraft={onCreateDraft}
        />
      )}
      <span data-line-number-content="">{lineNumber ?? ""}</span>
    </div>
  );
}

export function ReviewDiffLineContent({
  anchor,
  cellTone,
  children,
  comments,
  draft,
  readOnly = false,
  syncRow,
  onCancelDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  anchor: CommentAnchor | null;
  cellTone: ReviewCell["tone"];
  children: React.ReactNode;
  comments: DesktopReviewComment[];
  draft: CommentDraft | null;
  readOnly?: boolean;
  syncRow?: string;
  onCancelDraft: () => void;
  onDeleteComment: (commentId: string) => void;
  onDraftBodyChange: (body: string) => void;
  onResolveComment: (commentId: string) => void;
  onSaveDraft: () => void;
}): React.ReactNode {
  return (
    <div
      className="review-codex-diff__line"
      data-diff-sync-row={syncRow}
      data-line=""
      data-line-type={codexDiffLineType(cellTone)}
    >
      {children}
      {readOnly ? null : (
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
      )}
    </div>
  );
}

export function buildUnifiedDiffRows(
  file: DesktopReviewDiffFile,
): CodexDiffPaneRow[] {
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
  syntaxThemeId?: string,
): ReviewDiffSyntax {
  const { activeTheme, codeThemeId } = useDesktopTheme();
  const requestedThemeId = syntaxThemeId ?? codeThemeId;
  const requestedThemeVariant =
    CODEX_HIGHLIGHT_THEMES.find(
      (candidate) => candidate.slug === requestedThemeId,
    )?.variant ?? activeTheme.variant;
  const theme = resolveThemeId(
    requestedThemeId,
    requestedThemeVariant,
  );
  const language = normalizeSyntaxLanguage(resolveLanguageFromPath(file.path));
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
    language,
    theme,
  });

  return React.useMemo(() => {
    const highlighted = presentation.highlighted;
    const matchesRequest =
      highlighted?.code === code &&
      highlighted.requestedLanguage === language &&
      highlighted.requestedTheme === theme;
    if (!highlighted || !matchesRequest) {
      return {
        byLineId: new Map<string, readonly SyntaxToken[]>(),
        state: "loading",
      };
    }

    const byLineId = new Map<string, readonly SyntaxToken[]>();
    for (const [index, line] of lines.entries()) {
      const lineTokens = highlighted.tokens[index] ?? [];
      if (lineTokens.map((token) => token.content).join("") === line.content) {
        byLineId.set(line.id, lineTokens);
      }
    }
    return {
      byLineId,
      state: highlighted.language === "text" ? "plain" : "ready",
    };
  }, [code, language, lines, presentation.highlighted, theme]);
}

export function ReviewSyntaxText({
  content,
  line,
  ranges,
  syntaxByLineId,
}: {
  content: string;
  line: DesktopReviewDiffLine | null;
  ranges?: readonly ReviewIntralineRange[];
  syntaxByLineId: ReviewSyntaxByLineId;
}): React.ReactNode {
  const tokens = line ? syntaxByLineId.get(line.id) : undefined;
  const syntaxTokens =
    tokens?.length && tokens.map((token) => token.content).join("") === content
      ? tokens
      : undefined;
  const validRanges = normalizeReviewIntralineRanges(ranges, content.length);
  if (validRanges.length === 0) {
    if (!syntaxTokens) return content || " ";

    return syntaxTokens.map((token, index) => (
      <span
        key={`${line?.id ?? "line"}:${index}`}
        style={syntaxTokenStyle(token)}
      >
        {token.content}
      </span>
    ));
  }

  const segments: React.ReactNode[] = [];
  let offset = 0;
  const sourceSegments = syntaxTokens ?? [{ content }];

  for (const [tokenIndex, token] of sourceSegments.entries()) {
    const tokenStart = offset;
    const tokenEnd = tokenStart + token.content.length;
    offset = tokenEnd;
    const boundaries = new Set([tokenStart, tokenEnd]);
    for (const range of validRanges) {
      if (range.start > tokenStart && range.start < tokenEnd) {
        boundaries.add(range.start);
      }
      if (range.end > tokenStart && range.end < tokenEnd) {
        boundaries.add(range.end);
      }
    }
    const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
    for (let index = 0; index < sortedBoundaries.length - 1; index++) {
      const start = sortedBoundaries[index] ?? tokenStart;
      const end = sortedBoundaries[index + 1] ?? tokenEnd;
      if (end <= start) continue;
      const tone = validRanges.find(
        (range) => start < range.end && end > range.start,
      )?.tone;
      segments.push(
        <span
          className={tone ? "review-diff-word" : undefined}
          data-tone={tone}
          key={`${line?.id ?? "line"}:${tokenIndex}:${start}`}
          style={
            syntaxTokens ? syntaxTokenStyle(token as SyntaxToken) : undefined
          }
        >
          {token.content.slice(start - tokenStart, end - tokenStart)}
        </span>,
      );
    }
  }

  return segments.length > 0 ? segments : content || " ";
}

export function normalizeReviewIntralineRanges(
  ranges: readonly ReviewIntralineRange[] | undefined,
  contentLength: number,
): ReviewIntralineRange[] {
  if (!ranges || contentLength <= 0) return [];
  return ranges
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(contentLength, range.start)),
      end: Math.max(0, Math.min(contentLength, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
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

export function splitDiffLines(
  lines: DesktopReviewDiffLine[],
): ReviewSplitRow[] {
  return alignReviewDiffLines(lines).map((alignment) => {
    if (alignment.kind === "unchanged") {
      const { line } = alignment;
      return {
        id: line.id,
        left: reviewCellFromLine(line, "left"),
        right: reviewCellFromLine(line, "right"),
        paired: true,
      };
    }

    const { added, removed } = alignment;
    return {
      id:
        removed && added
          ? `${removed.id}-${added.id}`
          : (removed?.id ?? added?.id ?? "empty-change"),
      left: removed ? reviewCellFromLine(removed, "left") : emptyCell("left"),
      right: added ? reviewCellFromLine(added, "right") : emptyCell("right"),
      paired: Boolean(removed && added),
    };
  });
}

export function reviewCellFromLine(
  line: DesktopReviewDiffLine,
  side: DesktopReviewSide,
): ReviewCell {
  return {
    line,
    side,
    number: side === "left" ? line.oldLine : line.newLine,
    content: line.content,
    tone: line.type,
  };
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
