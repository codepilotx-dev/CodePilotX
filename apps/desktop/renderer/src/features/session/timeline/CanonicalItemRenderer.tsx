import React from "react";
import {
  Bot,
  Check,
  ChevronDown,
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

export type CanonicalItemRendererProps = {
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
      return <ToolItemView item={item} />;
    case "plan":
      return (
        <WorkflowPlanCard
          eventId={item.id}
          summary={item.markdown}
          streaming={item.state === "draft"}
          isDocked={rightDockPlanEventId === item.id}
          onOpenInRightDock={onOpenPlanInRightDock}
        />
      );
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
      <div className="canonical-process-card__body">
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
        <div className="canonical-process-card__body">
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

function ToolItemView({ item }: { item: ItemOf<"tool"> }): React.ReactNode {
  const active = item.state === "pending" || item.state === "running";
  const failed = item.state === "error";
  return (
    <details className="canonical-process-card canonical-tool" open={failed}>
      <summary>
        {active ? (
          <LoaderCircle className="canonical-spin" aria-hidden="true" />
        ) : failed ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <SquareTerminal aria-hidden="true" />
        )}
        <span>{item.title || item.tool}</span>
        <small>{toolStateLabel(item.state)}</small>
        <ChevronDown className="canonical-process-card__chevron" aria-hidden="true" />
      </summary>
      <div className="canonical-process-card__body">
        {item.command ? <pre><code>{item.command}</code></pre> : null}
        {item.output ? <pre><code>{item.output}</code></pre> : null}
        {item.error ? <p className="canonical-item-error">{item.error}</p> : null}
        {!item.command && !item.output && !item.error ? (
          <pre><code>{formatUnknown(item.input)}</code></pre>
        ) : null}
      </div>
    </details>
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

function CopyButton({ text }: { text: string }): React.ReactNode {
  const [copied, setCopied] = React.useState(false);
  return (
    <Tooltip content={copied ? "已复制" : "复制"}>
      <button
        aria-label={copied ? "已复制" : "复制"}
        className="canonical-icon-button"
        type="button"
        onClick={() => {
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

function toolStateLabel(state: ItemOf<"tool">["state"]): string {
  switch (state) {
    case "pending": return "等待";
    case "waiting-permission": return "等待授权";
    case "running": return "运行中";
    case "completed": return "完成";
    case "error": return "失败";
    case "interrupted": return "已中断";
  }
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
