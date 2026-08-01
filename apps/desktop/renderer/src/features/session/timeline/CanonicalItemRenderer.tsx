import React from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  ClipboardCheck,
  Copy,
  FileDiff,
  Hourglass,
  LoaderCircle,
  MessageCircleQuestion,
  NotepadText,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  Shield,
  SquareTerminal,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import type { Attachment, Input, Item } from "@codepilotx/shared/thread";
import type { RpcParams, RpcResult } from "@codepilotx/agent-protocol";
import type { DesktopDiffMarkerStyle } from "../../../../shared/types.js";

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { Button } from "../../../components/ui/Button.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { MarkdownMessage } from "../MarkdownMessage.js";
import { ConversationMarkdownErrorBoundary } from "../conversation/ConversationTurnErrorBoundary.js";
import { CollapsibleUserMarkdown } from "../conversation/CollapsibleUserMarkdown.js";
import { subagentStatusLabel } from "../subagents/subagentStatusLabel.js";
import { useConversationItemContext } from "./ConversationItemContext.js";
import {
  WorkflowPlanCard,
  type OpenPlanInDockRequest,
} from "../workflow/WorkflowPlanCard.js";

const LazyExpandableFileMutationRow = React.lazy(async () => {
  const module = await import("./ExpandableFileMutationRow.js");
  return { default: module.ExpandableFileMutationRow };
});

type ItemOf<T extends Item["type"]> = Extract<Item, { type: T }>;
type ToolItem = ItemOf<"tool">;

export type FileChangeDisplay = {
  additions: number | null;
  deletions: number | null;
  patch?: string | null;
  path: string;
};

export type FileMutationDisplay = {
  files: FileChangeDisplay[];
  state: ToolItem["state"];
  toolItemId: string;
  totalAdditions: number | null;
  totalDeletions: number | null;
};

export type PatchDisplay = {
  actionVersion?: number;
  applyState?: "applied" | "undone";
  files: FileChangeDisplay[];
  id: string;
  reversible?: boolean;
  totalAdditions: number | null;
  totalDeletions: number | null;
};

export type PatchAction = "undo" | "reapply";

export function patchFilesForDisplay(
  files: readonly FileChangeDisplay[],
  expanded: boolean,
): readonly FileChangeDisplay[] {
  return expanded ? files : files.slice(0, 3);
}

export type ToolItemDisplay = {
  active: boolean;
  canExpand: boolean;
  collapsedLabel: string;
  executionContent: string;
  expandedLabel: string;
  failed: boolean;
  resultText: string | null;
  showShellPrompt: boolean;
  statusLabel: string;
  toolLabel: string;
};

export type StructuredToolDetail = {
  executionContent: string;
  resultText: string | null;
};

export type LifecycleToolDisplay = {
  active: boolean;
  failed: boolean;
  icon: LucideIcon;
  label: string;
  toolLabel: string;
};

export type CanonicalItemDisclosure = {
  id: string;
  expanded: boolean;
  onExpandedChange: (id: string, expanded: boolean) => void;
};

export type ReadThreadPatchDiff = (
  params: RpcParams<"thread/patch/diff">,
) => Promise<RpcResult<"thread/patch/diff">>;

export type CanonicalItemRendererProps = {
  disclosure?: CanonicalItemDisclosure;
  item: Item;
  onApplyPatch?: (
    itemId: string,
    action: PatchAction,
    expectedVersion: number,
  ) => Promise<void>;
  onOpenPatchReview?: (path?: string) => void;
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  rightDockPlanEventId: string | null;
  showAssistantActions?: boolean;
  /** @default "standalone" — "grouped" applies tighter spacing inside a process group. */
  presentation?: "standalone" | "grouped";
};

export function CanonicalUserInput({
  attachments,
  input,
}: {
  attachments: readonly Attachment[];
  input: Input;
}): React.ReactNode {
  const {
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    onSubmitEditedUserMessage,
    sessionStatus,
    workspacePath,
  } = useConversationItemContext();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(input.content);
  const [submitting, setSubmitting] = React.useState(false);
  const canSubmit =
    draft.trim().length > 0 &&
    !submitting &&
    sessionStatus !== "running" &&
    sessionStatus !== "waiting";

  React.useEffect(() => {
    setDraft(input.content);
    setEditing(false);
  }, [input.content, input.id]);

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmitEditedUserMessage(draft.trim());
      setEditing(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (editing) {
    return (
      <article className="canonical-user-message canonical-user-message--editing">
        <textarea
          aria-label="修改用户消息"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(input.content);
              setEditing(false);
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="canonical-user-message__editor-actions">
          <button type="button" onClick={() => setEditing(false)}>取消</button>
          <button type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "发送中" : "发送"}
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="canonical-user-message">
      <div className="canonical-user-message__bubble" data-user-message-bubble>
        <CollapsibleUserMarkdown
          canCopyFileReferenceContents={canCopyFileReferenceContents}
          cwd={workspacePath}
          onCopyFileReferenceContents={onCopyFileReferenceContents}
          onOpenFileReference={onOpenFileReference}
          text={input.content}
        />
        {attachments.length ? (
          <ul className="canonical-user-message__attachments" aria-label="附件">
            {attachments.map((attachment) => (
              <li key={attachment.id} title={`${attachment.mediaType} · ${formatBytes(attachment.sizeBytes)}`}>
                <Paperclip aria-hidden="true" size={14} />
                <span>{attachment.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="canonical-message-actions" aria-label="用户消息操作">
        <CopyButton text={input.content} />
        <Tooltip content="修改并重新发送">
          <button
            aria-label="修改并重新发送"
            className="canonical-icon-button"
            type="button"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" size={APP_ICON_SIZE} />
          </button>
        </Tooltip>
      </div>
    </article>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CanonicalItemRenderer({
  disclosure,
  item,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
  showAssistantActions = false,
  presentation = "standalone",
}: CanonicalItemRendererProps): React.ReactNode {
  switch (item.type) {
    case "text":
      return <TextItemView item={item} showAssistantActions={showAssistantActions} />;
    case "reasoning":
      return <ReasoningItemView item={item} />;
    case "activity":
      return <ActivityItemView item={item} />;
    case "tool":
      return <ToolItemView disclosure={disclosure} item={item} />;
    case "plan":
      return (
        <WorkflowPlanCard
          eventId={item.id}
          summary={item.markdown}
          streaming={item.status === "streaming"}
          isDocked={rightDockPlanEventId === item.id}
          onOpenInRightDock={onOpenPlanInRightDock}
        />
      );
    case "execution-plan":
      return null;
    case "question":
      return <QuestionItemView item={item} />;
    case "patch":
      return (
        <PatchItemView
          item={item}
          onApplyPatch={onApplyPatch}
          onOpenReview={onOpenPatchReview}
        />
      );
    case "subagent":
      return <SubagentItemView item={item} onOpen={onOpenSubagent} />;
  }
}

function TextItemView({
  item,
  showAssistantActions,
}: {
  item: ItemOf<"text">;
  showAssistantActions: boolean;
}): React.ReactNode {
  const {
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    workspacePath,
  } = useConversationItemContext();

  if (!item.text.trim()) return null;
  return (
    <article
      className={`canonical-text-item canonical-text-item--${item.placement}`}
      data-streaming={item.status === "streaming" ? "true" : undefined}
    >
      <ConversationMarkdownErrorBoundary contentKey={`${item.id}:${item.text}`}>
        <MarkdownMessage
          canCopyFileReferenceContents={canCopyFileReferenceContents}
          cwd={workspacePath}
          onCopyFileReferenceContents={onCopyFileReferenceContents}
          onOpenFileReference={onOpenFileReference}
          streaming={item.status === "streaming"}
          text={item.text}
        />
      </ConversationMarkdownErrorBoundary>
      {showAssistantActions && item.status !== "streaming" ? (
        <div className="canonical-message-actions canonical-message-actions--assistant">
          <CopyButton text={item.text} />
        </div>
      ) : null}
    </article>
  );
}

function ReasoningItemView({ item }: { item: ItemOf<"reasoning"> }): React.ReactNode {
  const streaming = item.status === "streaming";
  return (
    <details className="canonical-process-card canonical-reasoning" open={streaming}>
      <summary>
        {streaming ? (
          <LoaderCircle className="canonical-spin" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        <span>{streaming ? "正在思考" : "思考过程"}</span>
        <ChevronDown className="canonical-process-card__chevron" aria-hidden="true" />
      </summary>
      <div className="canonical-process-card__body tw:bg-app-chrome">
        <ConversationMarkdownErrorBoundary contentKey={`${item.id}:${item.text}`}>
          <MarkdownMessage text={item.text || "正在整理思路…"} streaming={streaming} />
        </ConversationMarkdownErrorBoundary>
      </div>
    </details>
  );
}

function ActivityItemView({ item }: { item: ItemOf<"activity"> }): React.ReactNode {
  const active = item.status === "running";
  return (
    <details className="canonical-process-card canonical-activity" open={active}>
      <summary>
        {active ? (
          <LoaderCircle className="canonical-spin" aria-hidden="true" />
        ) : item.status === "error" ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        <span>{item.title}</span>
        <ChevronDown className="canonical-process-card__chevron" aria-hidden="true" />
      </summary>
      {item.detail || item.commands?.length ? (
        <div className="canonical-process-card__body tw:bg-app-chrome">
          {item.detail ? <p>{item.detail}</p> : null}
          {item.commands?.map((command, index) => (
            <pre key={`${item.id}:command:${index}`}>
              <code>{command.command}{command.output ? `\n${command.output}` : ""}</code>
            </pre>
          ))}
        </div>
      ) : null}
    </details>
  );
}

export function ToolItemView({
  disclosure,
  item,
}: {
  disclosure?: CanonicalItemDisclosure;
  item: ToolItem;
}): React.ReactNode {
  const view = buildToolItemDisplay(item);
  const expanded = view.canExpand && Boolean(disclosure?.expanded);

  React.useEffect(() => {
    if (!view.canExpand && disclosure?.expanded) {
      disclosure.onExpandedChange(disclosure.id, false);
    }
  }, [disclosure, view.canExpand]);

  return (
    <details
      className="canonical-process-card canonical-tool"
      data-expandable={view.canExpand ? "true" : "false"}
      data-state={item.state}
      onToggle={(event) => {
        if (!view.canExpand) {
          if (event.currentTarget.open) event.currentTarget.open = false;
          return;
        }
        disclosure?.onExpandedChange(disclosure.id, event.currentTarget.open);
      }}
      open={expanded}
    >
      <summary
        aria-disabled={!view.canExpand}
        onClick={(event) => {
          if (!view.canExpand) event.preventDefault();
        }}
        title={view.collapsedLabel}
      >
        {view.active ? (
          <LoaderCircle className="canonical-spin" aria-hidden="true" />
        ) : view.failed ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <SquareTerminal aria-hidden="true" />
        )}
        <span className="canonical-tool__summary-label">
          {expanded ? view.expandedLabel : view.collapsedLabel}
        </span>
        {expanded ? (
          <ChevronDown className="canonical-process-card__chevron" aria-hidden="true" />
        ) : (
          <ChevronRight className="canonical-process-card__chevron" aria-hidden="true" />
        )}
      </summary>
      {expanded ? <ToolExecutionCard item={item} view={view} /> : null}
    </details>
  );
}

export function ToolExecutionCard({
  item,
  view,
}: {
  item: ToolItem;
  view: ToolItemDisplay;
}): React.ReactNode {
  return (
    <article className="canonical-command-shell" data-state={item.state}>
      <header className="canonical-command-shell__header">{view.toolLabel}</header>
      <section className="canonical-command-shell__section" aria-label="执行内容">
        <CopyButton ariaLabel="复制执行内容" text={view.executionContent} />
        <pre>
          <code>
            {view.showShellPrompt ? <span className="canonical-command-shell__prompt">$ </span> : null}
            {view.executionContent}
          </code>
        </pre>
      </section>
      <section
        className="canonical-command-shell__section canonical-command-shell__result"
        aria-label="返回结果"
        data-empty={view.resultText ? undefined : "true"}
      >
        {view.resultText ? (
          <CopyButton ariaLabel="复制返回结果" text={view.resultText} />
        ) : null}
        <pre><code>{view.resultText ?? "无输出"}</code></pre>
      </section>
      <footer className="canonical-command-shell__footer">
        <span className="canonical-command-shell__status">
          {item.state === "completed" ? (
            <Check aria-hidden="true" />
          ) : item.state === "error" || item.state === "interrupted" ? (
            <CircleAlert aria-hidden="true" />
          ) : (
            <LoaderCircle className="canonical-spin" aria-hidden="true" />
          )}
          {view.statusLabel}
        </span>
      </footer>
    </article>
  );
}

function QuestionItemView({ item }: { item: ItemOf<"question"> }): React.ReactNode {
  return (
    <article className="canonical-blocker-card" data-state={item.status}>
      <header><CircleAlert aria-hidden="true" /><strong>{item.prompt}</strong></header>
      <div className="canonical-question-options">
        {item.choices.map((choice) => (
          <span key={choice.id} data-recommended={choice.recommended || undefined}>
            {choice.label}{choice.recommended ? " · 推荐" : ""}
          </span>
        ))}
      </div>
      {item.answer ? <p>已回答：{item.answer}</p> : <p>等待你的回答</p>}
    </article>
  );
}

function PatchItemView({
  item,
  onApplyPatch,
  onOpenReview,
}: {
  item: ItemOf<"patch">;
  onApplyPatch?: CanonicalItemRendererProps["onApplyPatch"];
  onOpenReview?: CanonicalItemRendererProps["onOpenPatchReview"];
}): React.ReactNode {
  return (
    <PatchSummaryView
      onApplyPatch={onApplyPatch}
      onOpenReview={onOpenReview}
      patch={{
        actionVersion: item.actionVersion,
        applyState: item.applyState,
        files: item.files.map((file) => ({
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
          path: file.path,
        })),
        id: item.id,
        reversible: item.reversible,
        totalAdditions: item.totalAdditions,
        totalDeletions: item.totalDeletions,
      }}
    />
  );
}

export function PatchSummaryView({
  onApplyPatch,
  onOpenReview,
  patch,
}: {
  onApplyPatch?: CanonicalItemRendererProps["onApplyPatch"];
  onOpenReview?: CanonicalItemRendererProps["onOpenPatchReview"];
  patch: PatchDisplay;
}): React.ReactNode {
  const [filesExpanded, setFilesExpanded] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<PatchAction | null>(
    null,
  );
  const [actionError, setActionError] = React.useState<string | null>(null);
  const hiddenFileCount = Math.max(0, patch.files.length - 3);
  const visibleFiles = patchFilesForDisplay(patch.files, filesExpanded);
  const patchAction: PatchAction =
    patch.applyState === "undone" ? "reapply" : "undo";
  const canApplyPatch = patch.reversible === true && Boolean(onApplyPatch);

  React.useEffect(() => {
    if (hiddenFileCount === 0 && filesExpanded) setFilesExpanded(false);
  }, [filesExpanded, hiddenFileCount]);

  const applyPatch = async (): Promise<void> => {
    if (!onApplyPatch || pendingAction) return;
    setPendingAction(patchAction);
    setActionError(null);
    try {
      await onApplyPatch(patch.id, patchAction, patch.actionVersion ?? 0);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : patchAction === "undo"
            ? "无法撤销文件修改"
            : "无法重新应用文件修改",
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <article className="canonical-patch-card">
      <header className="canonical-patch-card__header">
        <span className="canonical-patch-card__icon" aria-hidden="true">
          <FileDiff />
        </span>
        <span className="canonical-patch-card__summary">
          <strong>已编辑 {patch.files.length} 个文件</strong>
          <span>
            {patch.totalAdditions !== null ? (
              <span className="canonical-diff-add">+{patch.totalAdditions}</span>
            ) : null}
            {patch.totalDeletions !== null ? (
              <span className="canonical-diff-remove">-{patch.totalDeletions}</span>
            ) : null}
          </span>
        </span>
        <span className="canonical-patch-card__actions">
          {canApplyPatch ? (
            <Button
              className="canonical-patch-card__action"
              loading={pendingAction === patchAction}
              onClick={() => void applyPatch()}
            >
              <RotateCcw aria-hidden="true" size={APP_ICON_SIZE} />
              {patchAction === "undo" ? "撤销" : "重新应用"}
            </Button>
          ) : null}
          {onOpenReview ? (
            <Button
              className="canonical-patch-card__action"
              onClick={() =>
                onOpenReview(patch.files.length === 1 ? patch.files[0]?.path : undefined)
              }
            >
              审核
            </Button>
          ) : null}
        </span>
      </header>
      <div className="canonical-patch-card__files">
        {visibleFiles.map((file) => (
          <button
            className="canonical-patch-card__file"
            key={file.path}
            onClick={() => onOpenReview?.(file.path)}
            title={file.path}
            type="button"
          >
            <span>{file.path}</span>
            {file.additions !== null ? (
              <small className="canonical-diff-add">+{file.additions}</small>
            ) : null}
            {file.deletions !== null ? (
              <small className="canonical-diff-remove">-{file.deletions}</small>
            ) : null}
          </button>
        ))}
      </div>
      {hiddenFileCount > 0 ? (
        <Button
          aria-expanded={filesExpanded}
          className="canonical-patch-card__disclosure"
          onClick={() => setFilesExpanded((expanded) => !expanded)}
        >
          {filesExpanded ? "收起文件" : `再显示 ${hiddenFileCount} 个文件`}
          {filesExpanded ? (
            <ChevronDown aria-hidden="true" className="is-expanded" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
        </Button>
      ) : null}
      {actionError ? (
        <p className="canonical-patch-card__error" role="alert">
          {actionError}
        </p>
      ) : null}
    </article>
  );
}

export function FileMutationItemView({
  diffMarkerStyle = "color",
  disclosureState,
  item,
  readThreadPatchDiff,
  threadId,
}: {
  diffMarkerStyle?: DesktopDiffMarkerStyle;
  disclosureState?: {
    expandedIds: ReadonlySet<string>;
    onExpandedChange: (id: string, expanded: boolean) => void;
  };
  item: ToolItem;
  readThreadPatchDiff?: ReadThreadPatchDiff;
  threadId?: string;
}): React.ReactNode {
  const mutation = fileMutationDisplay(item);
  if (!mutation) return null;
  const active = isActiveToolState(item.state);
  const failed = item.state === "error" || item.state === "interrupted";

  return (
    <div className="canonical-file-mutation" data-state={item.state}>
      {mutation.files.map((file, fileIndex) => {
        const disclosureId = `file-mutation:${item.id}:${fileIndex}`;
        const canExpand =
          item.state === "completed" &&
          Boolean(threadId) &&
          Boolean(readThreadPatchDiff) &&
          item.mutationDiffPaths?.some((path) => sameMutationPath(path, file.path)) === true;
        if (!canExpand || !readThreadPatchDiff || !threadId) {
          return (
            <div
              className="canonical-file-mutation__row"
              key={`${item.id}:${file.path}`}
            >
              {active ? (
                <LoaderCircle className="canonical-spin" aria-hidden="true" />
              ) : failed ? (
                <CircleAlert aria-hidden="true" />
              ) : (
                <Pencil aria-hidden="true" />
              )}
              <span title={file.path}>{fileMutationLabel(item.state, file.path)}</span>
              <span className="canonical-file-mutation__stats">
                {file.additions !== null ? (
                  <small className="canonical-diff-add">+{file.additions}</small>
                ) : null}
                {file.deletions !== null ? (
                  <small className="canonical-diff-remove">-{file.deletions}</small>
                ) : null}
              </span>
            </div>
          );
        }
        const disclosure = {
          id: disclosureId,
          expanded: Boolean(disclosureState?.expandedIds.has(disclosureId)),
          onExpandedChange:
            disclosureState?.onExpandedChange ?? (() => undefined),
        };
        return (
          <React.Suspense
            fallback={(
              <div className="canonical-file-mutation__row">
                <Pencil aria-hidden="true" />
                <span title={file.path}>{fileMutationLabel(item.state, file.path)}</span>
                <span className="canonical-file-mutation__stats">
                  {file.additions !== null ? <small className="canonical-diff-add">+{file.additions}</small> : null}
                  {file.deletions !== null ? <small className="canonical-diff-remove">-{file.deletions}</small> : null}
                </span>
              </div>
            )}
            key={`${item.id}:${file.path}`}
          >
            <LazyExpandableFileMutationRow
              diffMarkerStyle={diffMarkerStyle}
              disclosure={disclosure}
              file={file}
              item={item}
              readThreadPatchDiff={readThreadPatchDiff}
              threadId={threadId}
            />
          </React.Suspense>
        );
      })}
    </div>
  );
}

function sameMutationPath(left: string, right: string): boolean {
  if (left === right) return true;
  const normalize = (value: string): string => value.replaceAll("\\", "/").toLocaleLowerCase("en-US");
  return normalize(left) === normalize(right);
}

function SubagentItemView({
  item,
  onOpen,
}: {
  item: ItemOf<"subagent">;
  onOpen: (taskId: string) => void;
}): React.ReactNode {
  const changedFiles = item.result?.changedFiles ?? [];
  return (
    <button
      className="canonical-subagent-card"
      type="button"
      onClick={() => onOpen(item.subagentTaskId)}
    >
      <Bot aria-hidden="true" />
      <span>
        <strong>{item.displayName}</strong>
        <small>{item.task}</small>
        {changedFiles.length > 0 ? (
          <small className="canonical-subagent-card__files">
            修改 {changedFiles.length} 个文件：
            {changedFiles.map((file) => file.path).join("、")}
          </small>
        ) : null}
      </span>
      <em>{subagentStatusLabel(item.status)}</em>
    </button>
  );
}

function CopyButton({
  ariaLabel = "复制",
  text,
}: {
  ariaLabel?: string;
  text: string;
}): React.ReactNode {
  const [copied, setCopied] = React.useState(false);
  return (
    <Tooltip content={copied ? "已复制" : ariaLabel}>
      <button
        aria-label={copied ? `${ariaLabel}：已复制` : ariaLabel}
        className="canonical-icon-button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        {copied ? <Check aria-hidden="true" size={APP_ICON_SIZE} /> : <Copy aria-hidden="true" size={APP_ICON_SIZE} />}
      </button>
    </Tooltip>
  );
}

function toolStateLabel(state: ToolItem["state"]): string {
  switch (state) {
    case "pending": return "等待";
    case "waiting-permission": return "等待授权";
    case "running": return "运行中";
    case "completed": return "成功";
    case "error": return "失败";
    case "interrupted": return "已中断";
  }
}

function nonBlank(value: string | null): string | null {
  return value && value.trim() ? value : null;
}

export function formatToolDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.ceil(Math.max(0, durationMs) / 1_000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return remainSec === 0
    ? `${minutes} 分钟`
    : `${minutes} 分 ${remainSec} 秒`;
}

export function buildToolItemDisplay(item: ToolItem): ToolItemDisplay {
  const command = nonBlank(item.command);
  const lifecycle = buildLifecycleToolDisplay(item);
  if (lifecycle) {
    return {
      active: lifecycle.active,
      canExpand: false,
      collapsedLabel: lifecycle.label,
      executionContent: lifecycle.label,
      expandedLabel: lifecycle.label,
      failed: lifecycle.failed,
      resultText: null,
      showShellPrompt: false,
      statusLabel: toolStateLabel(item.state),
      toolLabel: lifecycle.toolLabel,
    };
  }
  const structuredDetail = buildStructuredToolDetail(item);
  const formattedInput = formatToolInputForDisplay(item.tool, item.input);
  const safeInput = formattedInput.trim() && formattedInput.trim() !== "null"
    ? formattedInput
    : null;
  const fallbackExecution = item.title.trim() || item.tool;
  const executionContent = structuredDetail?.executionContent
    ?? command
    ?? safeInput
    ?? fallbackExecution;
  const resultText = structuredDetail
    ? structuredDetail.resultText
    : appendToolError(nonBlank(item.output), nonBlank(item.error));
  const active = isActiveToolState(item.state);
  const terminal = !active;
  const semanticSummary = buildToolSemanticSummary(item);

  return {
    active,
    canExpand: terminal || resultText !== null,
    collapsedLabel: semanticSummary.collapsedLabel,
    executionContent,
    expandedLabel: semanticSummary.expandedLabel,
    failed: item.state === "error" || item.state === "interrupted",
    resultText,
    showShellPrompt: command !== null,
    statusLabel: toolStateLabel(item.state),
    toolLabel: semanticSummary.toolLabel,
  };
}

type ToolSemanticSummary = {
  collapsedLabel: string;
  expandedLabel: string;
  toolLabel: string;
};

type SemanticAction = {
  completed: string;
  error: string;
  expandedCompleted: string;
  expandedRunning: string;
  interrupted: string;
  running: string;
  target: string | null;
  toolLabel: string;
};

function isActiveToolState(state: ToolItem["state"]): boolean {
  return (
    state === "pending"
    || state === "waiting-permission"
    || state === "running"
  );
}

function toolLeafName(tool: string): string {
  return (tool ?? "").trim().split(/[./]/).at(-1)?.toLowerCase() ?? "";
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function inputText(input: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function safeDisplayPath(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (/^(?:[a-z]:\/|\/)/i.test(normalized) || parts.includes("..")) {
    return parts.at(-1) ?? null;
  }
  return normalized || null;
}

function oneLine(value: string | null): string | null {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function semanticLabel(
  item: ToolItem,
  action: SemanticAction,
): ToolSemanticSummary {
  const target = oneLine(action.target);
  const suffix = target ? ` ${target}` : "";
  const collapsedLabel = item.state === "completed"
    ? `${action.completed}${suffix}`
    : item.state === "error"
      ? `${action.error}${suffix}`
      : item.state === "interrupted"
        ? `${action.interrupted}${suffix}`
        : `${action.running}${suffix}`;
  return {
    collapsedLabel,
    expandedLabel: isActiveToolState(item.state)
      ? action.expandedRunning
      : item.state === "completed"
        ? action.expandedCompleted
        : item.state === "error"
          ? action.error
          : action.interrupted,
    toolLabel: action.toolLabel,
  };
}

export function buildToolSemanticSummary(item: ToolItem): ToolSemanticSummary {
  const input = inputRecord(item.input);
  const command = oneLine(nonBlank(item.command));
  if (command) {
    const prefix = item.state === "completed"
      ? "Ran"
      : item.state === "error"
        ? "Command failed"
        : item.state === "interrupted"
          ? "Command interrupted"
          : "Running";
    return {
      collapsedLabel: `${prefix} ${command}`,
      expandedLabel: item.state === "completed"
        ? "Ran command"
        : item.state === "error"
          ? "Command failed"
          : item.state === "interrupted"
            ? "Command interrupted"
            : "Running command",
      toolLabel: "Shell",
    };
  }
  if (isToolSearchName(item.tool)) {
    return semanticLabel(item, {
      completed: "已搜索工具",
      error: "搜索工具失败",
      expandedCompleted: "已搜索工具",
      expandedRunning: "正在搜索工具",
      interrupted: "已中断搜索工具",
      running: "正在搜索工具",
      target: null,
      toolLabel: "工具搜索",
    });
  }

  switch (toolLeafName(item.tool)) {
    case "read":
      return semanticLabel(item, {
        completed: "已读取",
        error: "读取失败",
        expandedCompleted: "已读取文件",
        expandedRunning: "正在读取文件",
        interrupted: "已中断读取",
        running: "正在读取",
        target: safeDisplayPath(inputText(input, "file_path", "filePath", "path")),
        toolLabel: "文件读取",
      });
    case "grep":
      return semanticLabel(item, {
        completed: "已搜索",
        error: "搜索失败",
        expandedCompleted: "已搜索内容",
        expandedRunning: "正在搜索内容",
        interrupted: "已中断搜索",
        running: "正在搜索",
        target: inputText(input, "pattern", "query"),
        toolLabel: "内容搜索",
      });
    case "glob":
      return semanticLabel(item, {
        completed: "已查找",
        error: "查找失败",
        expandedCompleted: "已查找文件",
        expandedRunning: "正在查找文件",
        interrupted: "已中断查找",
        running: "正在查找",
        target: inputText(input, "pattern", "glob"),
        toolLabel: "文件查找",
      });
    case "toolsearch":
    case "tool_search":
      return semanticLabel(item, {
        completed: "已搜索工具",
        error: "搜索工具失败",
        expandedCompleted: "已搜索工具",
        expandedRunning: "正在搜索工具",
        interrupted: "已中断搜索工具",
        running: "正在搜索工具",
        target: null,
        toolLabel: "工具搜索",
      });
    case "update_plan":
      return semanticLabel(item, {
        completed: "已更新计划",
        error: "更新计划失败",
        expandedCompleted: "已更新计划",
        expandedRunning: "正在更新计划",
        interrupted: "已中断更新计划",
        running: "正在更新计划",
        target: null,
        toolLabel: "更新计划",
      });
    case "skill_read":
      return semanticLabel(item, {
        completed: "已读取技能",
        error: "读取技能失败",
        expandedCompleted: "已读取技能",
        expandedRunning: "正在读取技能",
        interrupted: "已中断读取技能",
        running: "正在读取技能",
        target: inputText(input, "name"),
        toolLabel: "技能读取",
      });
    default:
      return semanticLabel(item, {
        completed: "操作已完成",
        error: "操作失败",
        expandedCompleted: "操作已完成",
        expandedRunning: "正在执行操作",
        interrupted: "操作已中断",
        running: "正在执行操作",
        target: null,
        toolLabel: "操作",
      });
  }
}

type LifecycleAction = {
  completed: string;
  error: string;
  icon: LucideIcon;
  interrupted: string;
  running: string;
  toolLabel: string;
};

const LIFECYCLE_ACTIONS: Readonly<Record<string, LifecycleAction>> = {
  update_plan: {
    completed: "已更新计划",
    error: "更新计划失败",
    icon: NotepadText,
    interrupted: "已中断更新计划",
    running: "正在更新计划",
    toolLabel: "更新计划",
  },
  request_permissions: {
    completed: "已请求权限",
    error: "请求权限失败",
    icon: Shield,
    interrupted: "已中断请求权限",
    running: "正在请求权限",
    toolLabel: "请求权限",
  },
  request_user_input: {
    completed: "已获得回答",
    error: "提问失败",
    icon: MessageCircleQuestion,
    interrupted: "已中断提问",
    running: "正在等待回答",
    toolLabel: "提问",
  },
  spawn_agents: {
    completed: "已创建子代理",
    error: "创建子代理失败",
    icon: UserRoundPlus,
    interrupted: "已中断创建子代理",
    running: "正在创建子代理",
    toolLabel: "创建子代理",
  },
  wait_agents: {
    completed: "子代理已返回",
    error: "等待子代理失败",
    icon: Hourglass,
    interrupted: "已中断等待子代理",
    running: "正在等待子代理",
    toolLabel: "等待子代理",
  },
  send_agent: {
    completed: "已通知子代理",
    error: "通知子代理失败",
    icon: Send,
    interrupted: "已中断通知子代理",
    running: "正在通知子代理",
    toolLabel: "通知子代理",
  },
  stop_agent: {
    completed: "已停止子代理",
    error: "停止子代理失败",
    icon: CircleStop,
    interrupted: "已中断停止子代理",
    running: "正在停止子代理",
    toolLabel: "停止子代理",
  },
  finalize_result: {
    completed: "已提交子代理结果",
    error: "提交子代理结果失败",
    icon: ClipboardCheck,
    interrupted: "已中断提交子代理结果",
    running: "正在提交子代理结果",
    toolLabel: "提交子代理结果",
  },
};

export function buildLifecycleToolDisplay(
  item: ToolItem,
): LifecycleToolDisplay | null {
  const action = LIFECYCLE_ACTIONS[toolLeafName(item.tool)];
  if (!action) return null;
  const active = isActiveToolState(item.state);
  return {
    active,
    failed: item.state === "error" || item.state === "interrupted",
    icon: action.icon,
    label: item.state === "completed"
      ? action.completed
      : item.state === "error"
        ? action.error
        : item.state === "interrupted"
          ? action.interrupted
          : action.running,
    toolLabel: action.toolLabel,
  };
}

type ParsedToolOutput = {
  parsed: boolean;
  text: string | null;
  value: unknown;
};

function parsedToolOutput(output: string | null): ParsedToolOutput {
  const text = nonBlank(output);
  if (!text) return { parsed: false, text: null, value: null };
  try {
    return { parsed: true, text, value: JSON.parse(text) as unknown };
  } catch {
    return { parsed: false, text, value: text };
  }
}

function appendToolError(
  result: string | null,
  error: string | null,
): string | null {
  if (result && error) return `${result}\n${error}`;
  return result ?? error;
}

function isToolSearchName(tool: string): boolean {
  const normalized = tool.trim().toLowerCase();
  return normalized === "toolsearch"
    || normalized === "tool_search"
    || normalized === "tool.search";
}

function outputField(
  output: ParsedToolOutput,
  key: string,
): unknown {
  return output.parsed ? inputRecord(output.value)[key] : undefined;
}

function outputTextField(
  output: ParsedToolOutput,
  key: string,
): string | null {
  const value = outputField(output, key);
  return typeof value === "string" ? value : null;
}

function projectedOutputArray(
  output: ParsedToolOutput,
  keys: readonly string[],
  project: (value: unknown) => unknown | null,
): string | null {
  for (const key of keys) {
    const value = outputField(output, key);
    if (!Array.isArray(value)) continue;
    return JSON.stringify(
      value.flatMap((candidate) => {
        const projected = project(candidate);
        return projected === null ? [] : [projected];
      }),
      null,
      2,
    );
  }
  return null;
}

function projectSearchResult(value: unknown): unknown | null {
  if (typeof value === "string") {
    return safeDisplayPath(value) ?? "<workspace-path>";
  }
  const candidate = inputRecord(value);
  const projected: Record<string, unknown> = {};
  const path = inputText(candidate, "path", "file_path", "filePath");
  if (path) projected.path = safeDisplayPath(path) ?? "<workspace-path>";
  if (typeof candidate.line === "number" && Number.isFinite(candidate.line)) {
    projected.line = candidate.line;
  }
  if (typeof candidate.count === "number" && Number.isFinite(candidate.count)) {
    projected.count = candidate.count;
  }
  if (typeof candidate.text === "string") projected.text = candidate.text;
  for (const key of ["before", "after"] as const) {
    if (Array.isArray(candidate[key])) {
      projected[key] = candidate[key].filter(
        (line): line is string => typeof line === "string",
      );
    }
  }
  return Object.keys(projected).length ? projected : null;
}

function projectToolSearchResult(value: unknown): unknown | null {
  const candidate = inputRecord(value);
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
  return {
    name: candidate.name,
    ...(typeof candidate.description === "string"
      ? { description: candidate.description }
      : {}),
  };
}

function structuredResult(
  output: ParsedToolOutput,
  projected: string | null,
  error: string | null,
): string | null {
  return appendToolError(
    projected ?? (!output.parsed ? output.text : null),
    error,
  );
}

export function buildStructuredToolDetail(
  item: ToolItem,
): StructuredToolDetail | null {
  const leaf = toolLeafName(item.tool);
  const input = inputRecord(item.input);
  const output = parsedToolOutput(item.output);
  const error = nonBlank(item.error);

  switch (leaf) {
    case "read":
      return {
        executionContent: safeDisplayPath(
          inputText(input, "file_path", "filePath", "path"),
        ) ?? "未提供文件路径",
        resultText: structuredResult(
          output,
          outputTextField(output, "content"),
          error,
        ),
      };
    case "grep":
      return {
        executionContent: inputText(input, "pattern", "query") ?? "未提供搜索条件",
        resultText: structuredResult(
          output,
          projectedOutputArray(
            output,
            ["files", "matches", "counts"],
            projectSearchResult,
          ),
          error,
        ),
      };
    case "glob":
      return {
        executionContent: inputText(input, "pattern", "glob") ?? "未提供匹配条件",
        resultText: structuredResult(
          output,
          projectedOutputArray(output, ["matches"], projectSearchResult),
          error,
        ),
      };
    case "toolsearch":
    case "tool_search":
      return {
        executionContent: inputText(input, "query") ?? "未提供工具搜索条件",
        resultText: structuredResult(
          output,
          projectedOutputArray(output, ["tools"], projectToolSearchResult),
          error,
        ),
      };
    case "skill_read":
      return {
        executionContent: inputText(input, "name") ?? "未提供技能名称",
        resultText: structuredResult(
          output,
          outputTextField(output, "content"),
          error,
        ),
      };
    default:
      if (!isToolSearchName(item.tool)) return null;
      return {
        executionContent: inputText(input, "query") ?? "未提供工具搜索条件",
        resultText: structuredResult(
          output,
          projectedOutputArray(output, ["tools"], projectToolSearchResult),
          error,
        ),
      };
  }
}

export function isStandaloneLifecycleTool(item: ToolItem): boolean {
  return buildLifecycleToolDisplay(item) !== null;
}

export function LifecycleToolItemView({
  item,
}: {
  item: ToolItem;
}): React.ReactNode {
  const display = buildLifecycleToolDisplay(item);
  if (!display) return null;
  const LifecycleIcon = display.icon;
  return (
    <div
      className="canonical-lifecycle-tool"
      data-state={item.state}
      role={display.active ? "status" : undefined}
    >
      {display.failed ? (
        <CircleAlert aria-hidden="true" />
      ) : (
        <span className="canonical-lifecycle-tool__icon">
          <LifecycleIcon aria-hidden="true" />
          {display.active ? (
            <LifecycleIcon
              className="canonical-lifecycle-tool__icon-flash"
              aria-hidden="true"
            />
          ) : null}
        </span>
      )}
      <span>{display.label}</span>
    </div>
  );
}

export function isFileMutationTool(item: ToolItem): boolean {
  const leaf = toolLeafName(item.tool);
  return leaf === "apply_patch" || leaf === "write" || leaf === "edit";
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function parsedOutputRecord(output: string | null): Record<string, unknown> {
  if (!output?.trim()) return {};
  try {
    const parsed = JSON.parse(output) as unknown;
    return inputRecord(parsed);
  } catch {
    return {};
  }
}

function fileCandidates(value: unknown): FileChangeDisplay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const record = inputRecord(candidate);
    const path = safeDisplayPath(inputText(record, "path", "file_path", "filePath"));
    return path
      ? [{
          additions: nonNegativeInteger(record.additions),
          deletions: nonNegativeInteger(record.deletions),
          path,
        }]
      : [];
  });
}

function mergeFileCandidates(
  preferred: readonly FileChangeDisplay[],
  fallback: readonly FileChangeDisplay[],
): FileChangeDisplay[] {
  const files = new Map<string, FileChangeDisplay>();
  for (const file of [...fallback, ...preferred]) {
    const current = files.get(file.path);
    files.set(file.path, {
      additions: file.additions ?? current?.additions ?? null,
      deletions: file.deletions ?? current?.deletions ?? null,
      path: file.path,
    });
  }
  return [...files.values()];
}

export function fileMutationDisplay(item: ToolItem): FileMutationDisplay | null {
  if (!isFileMutationTool(item)) return null;
  const input = inputRecord(item.input);
  const output = parsedOutputRecord(item.output);
  const outputSummary = inputRecord(output.summary);
  const inputSummary = inputRecord(input.summary);
  let files = mergeFileCandidates(
    fileCandidates(output.files),
    fileCandidates(input.affectedPaths ?? input.files),
  );
  if (files.length === 0) {
    const path = safeDisplayPath(
      inputText(output, "path", "file_path", "filePath")
      ?? inputText(input, "file_path", "filePath", "path"),
    );
    if (path) files = [{ additions: null, deletions: null, path }];
  }
  if (files.length === 0) {
    files = [{ additions: null, deletions: null, path: "文件" }];
  }
  const totalAdditions = nonNegativeInteger(
    output.totalAdditions
    ?? output.additions
    ?? outputSummary.additions
    ?? input.totalAdditions
    ?? input.additions
    ?? inputSummary.additions,
  );
  const totalDeletions = nonNegativeInteger(
    output.totalDeletions
    ?? output.deletions
    ?? outputSummary.deletions
    ?? input.totalDeletions
    ?? input.deletions
    ?? inputSummary.deletions,
  );
  if (files.length === 1) {
    files = [{
      additions: files[0].additions ?? totalAdditions,
      deletions: files[0].deletions ?? totalDeletions,
      path: files[0].path,
    }];
  }
  return {
    files,
    state: item.state,
    toolItemId: item.id,
    totalAdditions,
    totalDeletions,
  };
}

export function fileMutationLabel(state: ToolItem["state"], path: string): string {
  if (state === "completed") return `已编辑 ${path}`;
  if (state === "error") return `编辑失败 ${path}`;
  if (state === "interrupted") return `已中断编辑 ${path}`;
  return `正在编辑 ${path}`;
}

export function syntheticPatchDisplay(items: readonly Item[]): PatchDisplay | null {
  const mutations = items.flatMap((item) => {
    if (item.type !== "tool" || item.state !== "completed") return [];
    const display = fileMutationDisplay(item);
    if (!display) return [];
    const files = display.files.filter((file) => file.path !== "文件");
    return files.length ? [{ ...display, files }] : [];
  });
  if (mutations.length === 0) return null;

  const files = new Map<string, FileChangeDisplay>();
  for (const mutation of mutations) {
    for (const file of mutation.files) {
      const current = files.get(file.path);
      files.set(file.path, {
        additions: current?.additions !== null
          && current?.additions !== undefined
          && file.additions !== null
          ? current.additions + file.additions
          : current?.additions ?? file.additions,
        deletions: current?.deletions !== null
          && current?.deletions !== undefined
          && file.deletions !== null
          ? current.deletions + file.deletions
          : current?.deletions ?? file.deletions,
        path: file.path,
      });
    }
  }
  const totalsKnown = mutations.every(
    (mutation) => mutation.totalAdditions !== null && mutation.totalDeletions !== null,
  );
  return {
    files: [...files.values()],
    id: "synthetic-tool-patch",
    totalAdditions: totalsKnown
      ? mutations.reduce((total, mutation) => total + mutation.totalAdditions!, 0)
      : null,
    totalDeletions: totalsKnown
      ? mutations.reduce((total, mutation) => total + mutation.totalDeletions!, 0)
      : null,
  };
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatToolInputForDisplay(tool: string, input: unknown): string {
  const leaf = toolLeafName(tool);
  if (
    leaf === "apply_patch"
    && input
    && typeof input === "object"
    && !Array.isArray(input)
  ) {
    const { patch: _patch, ...safeInput } = input as Record<string, unknown>;
    return formatUnknown({
      ...safeInput,
      patch: "[补丁正文已隐藏]",
    });
  }
  if (
    (leaf === "read" || leaf === "grep" || leaf === "glob")
    && input
    && typeof input === "object"
    && !Array.isArray(input)
  ) {
    const safeInput = { ...input as Record<string, unknown> };
    for (const key of ["file_path", "filePath", "path"]) {
      if (typeof safeInput[key] === "string") {
        safeInput[key] = safeDisplayPath(safeInput[key]) ?? "<workspace-path>";
      }
    }
    return formatUnknown(safeInput);
  }
  return formatUnknown(input);
}
