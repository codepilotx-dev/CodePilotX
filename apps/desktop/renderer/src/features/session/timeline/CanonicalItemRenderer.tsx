import React from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  FileDiff,
  LoaderCircle,
  Paperclip,
  Pencil,
  SquareTerminal,
} from "lucide-react";
import type { Attachment, Input, Item } from "@codepilotx/shared/thread";

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { MarkdownMessage } from "../MarkdownMessage.js";
import { ConversationMarkdownErrorBoundary } from "../conversation/ConversationTurnErrorBoundary.js";
import { CollapsibleUserMarkdown } from "../conversation/CollapsibleUserMarkdown.js";
import { useQuickChatContext } from "../QuickChatContext.js";
import {
  WorkflowPlanCard,
  type OpenPlanInDockRequest,
} from "../workflow/WorkflowPlanCard.js";

type ItemOf<T extends Item["type"]> = Extract<Item, { type: T }>;
type ToolItem = ItemOf<"tool">;

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

export type CanonicalItemDisclosure = {
  id: string;
  expanded: boolean;
  onExpandedChange: (id: string, expanded: boolean) => void;
};

export type CanonicalItemRendererProps = {
  disclosure?: CanonicalItemDisclosure;
  item: Item;
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  rightDockPlanEventId: string | null;
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
  } = useQuickChatContext();
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
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
  presentation = "standalone",
}: CanonicalItemRendererProps): React.ReactNode {
  switch (item.type) {
    case "text":
      return <TextItemView item={item} />;
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
      return <PatchItemView item={item} />;
    case "subagent":
      return <SubagentItemView item={item} onOpen={onOpenSubagent} />;
  }
}

function TextItemView({ item }: { item: ItemOf<"text"> }): React.ReactNode {
  const {
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    workspacePath,
  } = useQuickChatContext();

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
      {item.placement === "result" && item.status !== "streaming" ? (
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
        title={view.executionContent}
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

function PatchItemView({ item }: { item: ItemOf<"patch"> }): React.ReactNode {
  return (
    <details className="canonical-patch-card">
      <summary>
        <FileDiff aria-hidden="true" />
        <strong>{item.files.length} 个文件已更改</strong>
        <span className="canonical-diff-add">+{item.totalAdditions}</span>
        <span className="canonical-diff-remove">-{item.totalDeletions}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="canonical-patch-card__files">
        {item.files.map((file) => (
          <details key={file.path}>
            <summary>
              <span>{file.path}</span>
              <small className="canonical-diff-add">+{file.additions}</small>
              <small className="canonical-diff-remove">-{file.deletions}</small>
            </summary>
            {file.patch ? <pre><code>{file.patch}</code></pre> : null}
          </details>
        ))}
      </div>
    </details>
  );
}

function SubagentItemView({
  item,
  onOpen,
}: {
  item: ItemOf<"subagent">;
  onOpen: (taskId: string) => void;
}): React.ReactNode {
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
      </span>
      <em>{item.status}</em>
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

function toolDurationMs(item: ToolItem): number | null {
  if (item.durationMs !== null) return Math.max(0, item.durationMs);
  if (item.startedAt === null || item.finishedAt === null) return null;
  return Math.max(0, item.finishedAt - item.startedAt);
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

function toolPreview(item: ToolItem): string {
  const source = nonBlank(item.command) ?? (item.title.trim() || item.tool);
  return source.replace(/\s+/g, " ").trim();
}

function displayToolName(toolName: string): string {
  return toolName === "Bash" ? "Shell" : toolName;
}

export function buildToolItemDisplay(item: ToolItem): ToolItemDisplay {
  const command = nonBlank(item.command);
  const formattedInput = formatToolInputForDisplay(item.tool, item.input);
  const safeInput = formattedInput.trim() && formattedInput.trim() !== "null"
    ? formattedInput
    : null;
  const fallbackExecution = item.title.trim() || item.tool;
  const executionContent = command
    ?? safeInput
    ?? fallbackExecution;
  const output = nonBlank(item.output);
  const error = nonBlank(item.error);
  const resultText = output && error
    ? `${output}\n${error}`
    : output ?? error;
  const active = (
    item.state === "pending"
    || item.state === "waiting-permission"
    || item.state === "running"
  );
  const terminal = !active;
  const durationMs = terminal ? toolDurationMs(item) : null;
  const collapsedPrefix = item.state === "running"
    ? "正在运行"
    : active
      ? "等待运行"
      : "已运行";

  return {
    active,
    canExpand: terminal || resultText !== null,
    collapsedLabel: `${collapsedPrefix} ${toolPreview(item)}`,
    executionContent,
    expandedLabel: active
      ? "命令正在运行"
      : durationMs === null
        ? "命令已运行"
        : `命令运行了 ${formatToolDuration(durationMs)}`,
    failed: item.state === "error" || item.state === "interrupted",
    resultText,
    showShellPrompt: command !== null,
    statusLabel: toolStateLabel(item.state),
    toolLabel: displayToolName(item.tool),
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
  if (
    tool.toLowerCase().split(".").at(-1) === "apply_patch"
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
  return formatUnknown(input);
}
