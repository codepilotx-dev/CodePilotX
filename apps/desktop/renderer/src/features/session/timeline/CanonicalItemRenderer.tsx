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
  Globe2,
  GitFork,
  Hourglass,
  LoaderCircle,
  MessageCircleQuestion,
  NotepadText,
  Pencil,
  RotateCcw,
  Send,
  Shield,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import type { Attachment, Input, Item, LocalContextReference, ToolResultBlock } from "@codepilotx/shared/thread";
import type { RpcParams, RpcResult } from "@codepilotx/agent-protocol";
import type { DesktopDiffMarkerStyle } from "../../../../shared/types.js";
import type {
  ComposerEditorHandle,
  ComposerEditorProps,
} from "../composer/ComposerEditor.js";

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { Button } from "../../../components/ui/Button.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { DisclosureContent } from "../../../components/ui/DisclosureContent.js";
import {
  type KeyedDisclosureStore,
  useDisclosureExpanded,
} from "../../../components/ui/keyedDisclosureStore.js";
import { desktopClipboard } from "../../../services/desktop-client/index.js";
import { CodeBlock } from "../../syntax/CodeBlock.js";
import { MarkdownMessage } from "../../markdown/index.js";
import { ConversationMarkdownErrorBoundary } from "../conversation/ConversationTurnErrorBoundary.js";
import { CollapsibleUserMarkdown } from "../conversation/CollapsibleUserMarkdown.js";
import { subagentStatusLabel } from "../subagents/subagentStatusLabel.js";
import { useScrollEdgeState } from "../../../hooks/useScrollEdgeState.js";
import { useConversationItemContext } from "./ConversationItemContext.js";
import {
  WorkflowPlanCard,
  type OpenPlanInDockRequest,
} from "../workflow/WorkflowPlanCard.js";
import {
  AttachmentFilePill,
  AttachmentImageTile,
} from "../attachments/AttachmentRowPrimitives.js";
import { useToolArtifactImageSource } from "./useToolArtifactImageSource.js";
import {
  buildToolSemanticSummary,
  ToolActivityLabel,
  toolSemanticIcon,
  type ToolActivityIconKind,
  type ToolSemanticKind,
  type ToolSemanticSummary,
} from "./ToolActivityPresentation.js";

export {
  buildToolSemanticSummary,
  cleanCommandSummary,
  formatToolDuration,
  toolSemanticIcon,
} from "./ToolActivityPresentation.js";
export type { ToolSemanticKind } from "./ToolActivityPresentation.js";

const LazyExpandableFileMutationRow = React.lazy(async () => {
  const module = await import("./ExpandableFileMutationRow.js");
  return { default: module.ExpandableFileMutationRow };
});

const LazyComposerEditor = React.lazy(async () => {
  const module = await import("../composer/ComposerEditor.js");
  return {
    default: module.ComposerEditor as React.ForwardRefExoticComponent<
      ComposerEditorProps & React.RefAttributes<ComposerEditorHandle>
    >,
  };
});

const LazyThreadAttachmentRows = React.lazy(async () => {
  const module = await import("../attachments/AttachmentRows.js");
  return { default: module.ThreadAttachmentRows };
});

const LazyLocalContextRows = React.lazy(async () => {
  const module = await import("../attachments/LocalContextRows.js");
  return { default: module.LocalContextRows };
});

type ItemOf<T extends Item["type"]> = Extract<Item, { type: T }>;
type ToolItem = ItemOf<"tool">;

export type FileChangeDisplay = {
  additions: number | null;
  deletions: number | null;
  operation?: "write" | "create" | "update" | "delete";
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
  iconKind: ToolActivityIconKind;
  resultText: string | null;
  semanticSummary: ToolSemanticSummary | null;
  statusLabel: string;
  semanticKind: ToolSemanticKind;
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
  store: KeyedDisclosureStore;
};

type ResolvedCanonicalItemDisclosure = {
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
  /** Thread scope used to resolve tool artifact content. */
  threadId?: string;
};

export function CanonicalUserInput({
  attachments,
  contextReferences,
  input,
}: {
  attachments: readonly Attachment[];
  contextReferences: readonly LocalContextReference[];
  input: Input;
}): React.ReactNode {
  const {
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    onOpenAttachment,
    onOpenLocalContext,
    onSubmitEditedUserMessage,
    sessionStatus,
    workspacePath,
  } = useConversationItemContext();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(input.content);
  const [retainedAttachmentIds, setRetainedAttachmentIds] = React.useState<
    string[]
  >(() => [...(input.attachmentIds ?? [])]);
  const [retainedContextReferenceIds, setRetainedContextReferenceIds] = React.useState<
    string[]
  >(() => [...(input.contextReferenceIds ?? [])]);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const editorRef = React.useRef<ComposerEditorHandle | null>(null);
  const retainedAttachments = React.useMemo(
    () =>
      attachments.filter((attachment) =>
        retainedAttachmentIds.includes(attachment.id),
      ),
    [attachments, retainedAttachmentIds],
  );
  const retainedContextReferences = React.useMemo(
    () => contextReferences.filter(reference =>
      retainedContextReferenceIds.includes(reference.id),
    ),
    [contextReferences, retainedContextReferenceIds],
  );
  const canSubmit =
    draft.trim().length > 0 &&
    !submitting &&
    sessionStatus !== "running" &&
    sessionStatus !== "waiting";

  React.useEffect(() => {
    setDraft(input.content);
    setRetainedAttachmentIds([...(input.attachmentIds ?? [])]);
    setRetainedContextReferenceIds([...(input.contextReferenceIds ?? [])]);
    setSubmitError(null);
    setEditing(false);
  }, [input.content, input.id]);

  React.useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => editorRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  const cancelEditing = (): void => {
    setDraft(input.content);
    setRetainedAttachmentIds([...(input.attachmentIds ?? [])]);
    setRetainedContextReferenceIds([...(input.contextReferenceIds ?? [])]);
    setSubmitError(null);
    setEditing(false);
  };

  const startEditing = (): void => {
    setDraft(input.content);
    setRetainedAttachmentIds([...(input.attachmentIds ?? [])]);
    setRetainedContextReferenceIds([...(input.contextReferenceIds ?? [])]);
    setSubmitError(null);
    setEditing(true);
  };

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmitEditedUserMessage({
        text: draft.trim(),
        retainedAttachmentIds,
        retainedContextReferenceIds,
      });
      setEditing(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "消息发送失败，请重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (editing) {
    return (
      <article className="canonical-user-message canonical-user-message--editing">
        <div className="canonical-user-message__editor-surface">
          {retainedAttachments.length > 0 ? (
            <React.Suspense fallback={null}>
              <LazyThreadAttachmentRows
                attachments={retainedAttachments}
                onOpen={onOpenAttachment}
                onRemove={(attachmentId) =>
                  setRetainedAttachmentIds((current) =>
                    current.filter((id) => id !== attachmentId),
                  )
                }
              />
            </React.Suspense>
          ) : null}
          {retainedContextReferences.length > 0 ? (
            <React.Suspense fallback={null}>
              <LazyLocalContextRows
                references={retainedContextReferences}
                onOpen={onOpenLocalContext}
                onRemove={(referenceId) =>
                  setRetainedContextReferenceIds(current =>
                    current.filter(id => id !== referenceId),
                  )
                }
              />
            </React.Suspense>
          ) : null}
          <React.Suspense fallback={null}>
            <LazyComposerEditor
              ariaDescribedBy={submitError ? `edit-error-${input.id}` : undefined}
              ariaExpanded={false}
              onChange={setDraft}
              onCompositionChange={() => undefined}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditing();
                  return true;
                }
                if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey)
                ) {
                  event.preventDefault();
                  void submit();
                  return true;
                }
                return false;
              }}
              onSelectionChange={() => undefined}
              placeholder="修改消息"
              ref={editorRef}
              value={draft}
            />
          </React.Suspense>
          {submitError ? (
            <p
              className="canonical-user-message__editor-error"
              id={`edit-error-${input.id}`}
              role="alert"
            >
              {submitError}
            </p>
          ) : null}
          <div className="canonical-user-message__editor-actions">
            <Button color="secondary" onClick={cancelEditing}>取消</Button>
            <Button color="primary"
              disabled={!canSubmit}
              loading={submitting}
              onClick={() => void submit()}
            >
              发送
            </Button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="canonical-user-message">
      {attachments.length > 0 ? (
        <React.Suspense fallback={null}>
          <LazyThreadAttachmentRows
            attachments={attachments}
            onOpen={onOpenAttachment}
          />
        </React.Suspense>
      ) : null}
      {contextReferences.length > 0 ? (
        <React.Suspense fallback={null}>
          <LazyLocalContextRows
            references={contextReferences}
            onOpen={onOpenLocalContext}
          />
        </React.Suspense>
      ) : null}
      <div className="canonical-user-message__bubble" data-user-message-bubble>
        <CollapsibleUserMarkdown
          canCopyFileReferenceContents={canCopyFileReferenceContents}
          cwd={workspacePath}
          onCopyFileReferenceContents={onCopyFileReferenceContents}
          onOpenFileReference={onOpenFileReference}
          text={input.content}
        />
      </div>
      <div className="canonical-message-actions" aria-label="用户消息操作">
        <CopyButton text={input.content} />
        <Tooltip content="修改并重新发送">
          <IconButton
            aria-label="修改并重新发送"
            color="ghostSecondary"
            size="toolbar"
            title="修改并重新发送"
            onClick={startEditing}
          >
            <Pencil aria-hidden="true" size={APP_ICON_SIZE} />
          </IconButton>
        </Tooltip>
      </div>
    </article>
  );
}

export function CanonicalItemRenderer({
  disclosure,
  ...props
}: CanonicalItemRendererProps): React.ReactNode {
  if (disclosure) {
    return <SubscribedCanonicalItemRenderer {...props} disclosure={disclosure} />;
  }
  return <CanonicalItemRendererContent {...props} />;
}

function SubscribedCanonicalItemRenderer({
  disclosure,
  ...props
}: Omit<CanonicalItemRendererProps, "disclosure"> & {
  disclosure: CanonicalItemDisclosure;
}): React.ReactNode {
  const expanded = useDisclosureExpanded(disclosure.store, disclosure.id);
  const resolvedDisclosure = React.useMemo<ResolvedCanonicalItemDisclosure>(
    () => ({
      id: disclosure.id,
      expanded,
      onExpandedChange: (id, nextExpanded) => disclosure.store.setExpanded(id, nextExpanded),
    }),
    [disclosure.id, disclosure.store, expanded],
  );
  return <CanonicalItemRendererContent {...props} disclosure={resolvedDisclosure} />;
}

function CanonicalItemRendererContent({
  disclosure,
  item,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
  showAssistantActions = false,
  presentation = "standalone",
  threadId,
}: Omit<CanonicalItemRendererProps, "disclosure"> & {
  disclosure?: ResolvedCanonicalItemDisclosure;
}): React.ReactNode {
  switch (item.type) {
    case "text":
      return <TextItemView item={item} showAssistantActions={showAssistantActions} />;
    case "reasoning":
      return <ReasoningItemView disclosure={disclosure} item={item} />;
    case "activity":
      return <ActivityItemView disclosure={disclosure} item={item} />;
    case "tool":
      return (
        <ToolItemView
          disclosure={disclosure}
          item={item}
          presentation={presentation}
          threadId={threadId}
        />
      );
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
    onForkFromMessage,
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
          {item.placement === "result" && item.status === "completed" && onForkFromMessage ? (
            <Tooltip content="在新聊天中继续">
              <IconButton
                aria-label="在新聊天中继续"
                color="ghostSecondary"
                size="toolbar"
                title="在新聊天中继续"
                onClick={event => {
                  event.stopPropagation();
                  onForkFromMessage({ itemId: item.id, turnId: item.turnId });
                }}
              >
                <GitFork
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </IconButton>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ReasoningItemView({ disclosure, item }: {
  disclosure?: ResolvedCanonicalItemDisclosure;
  item: ItemOf<"reasoning">;
}): React.ReactNode {
  const streaming = item.status === "streaming";
  const [localExpanded, setLocalExpanded] = React.useState(streaming);
  const expanded = disclosure?.expanded ?? localExpanded;
  const contentId = React.useId();

  React.useEffect(() => {
    if (!disclosure) setLocalExpanded(streaming);
  }, [disclosure, streaming]);

  const setExpanded = (next: boolean): void => {
    if (disclosure) disclosure.onExpandedChange(disclosure.id, next);
    else setLocalExpanded(next);
  };

  return (
    <div
      className="canonical-process-card canonical-reasoning"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="canonical-process-card__summary"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {streaming ? (
          <LoaderCircle className="canonical-spin" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        <span>{streaming ? "正在思考" : "思考过程"}</span>
        <ChevronDown className="canonical-process-card__chevron" aria-hidden="true" />
      </button>
      <DisclosureContent
        contentClassName="canonical-process-card__body tw:bg-app-chrome"
        expanded={expanded}
        id={contentId}
        mountPolicy="always"
      >
        <ConversationMarkdownErrorBoundary contentKey={`${item.id}:${item.text}`}>
          <MarkdownMessage text={item.text || "正在整理思路…"} streaming={streaming} />
        </ConversationMarkdownErrorBoundary>
      </DisclosureContent>
    </div>
  );
}

function ActivityItemView({ disclosure, item }: {
  disclosure?: ResolvedCanonicalItemDisclosure;
  item: ItemOf<"activity">;
}): React.ReactNode {
  const active = item.status === "running";
  const canExpand = Boolean(item.detail || item.commands?.length);
  const [localExpanded, setLocalExpanded] = React.useState(active && canExpand);
  const requestedExpanded = disclosure?.expanded ?? localExpanded;
  const expanded = canExpand && requestedExpanded;
  const contentId = React.useId();

  React.useEffect(() => {
    if (!disclosure) setLocalExpanded(active && canExpand);
  }, [active, canExpand, disclosure]);

  const setExpanded = (next: boolean): void => {
    if (disclosure) disclosure.onExpandedChange(disclosure.id, next);
    else setLocalExpanded(next);
  };

  return (
    <div
      className="cpx-agent-activity__item"
      data-expandable={canExpand ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        aria-controls={canExpand ? contentId : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        className="cpx-agent-activity__item-header"
        disabled={!canExpand}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {active ? (
          <LoaderCircle className="cpx-agent-activity__icon canonical-spin" aria-hidden="true" />
        ) : item.status === "error" ? (
          <CircleAlert className="cpx-agent-activity__icon" aria-hidden="true" />
        ) : (
          <Check className="cpx-agent-activity__icon" aria-hidden="true" />
        )}
        <span className="cpx-agent-activity__label">{item.title}</span>
        <ChevronRight className="cpx-agent-activity__chevron" aria-hidden="true" />
      </button>
      <DisclosureContent
        contentClassName="cpx-agent-activity__details"
        expanded={expanded}
        id={contentId}
        mountPolicy="always"
      >
        {canExpand ? (
          <>
          {item.detail ? <p>{item.detail}</p> : null}
          {item.commands?.map((command, index) => (
            <pre key={`${item.id}:command:${index}`}>
              <code>{command.command}{command.output ? `\n${command.output}` : ""}</code>
            </pre>
          ))}
          </>
        ) : null}
      </DisclosureContent>
    </div>
  );
}

export function ToolItemView({
  disclosure,
  item,
  presentation = "standalone",
  threadId,
}: {
  disclosure?: ResolvedCanonicalItemDisclosure;
  item: ToolItem;
  presentation?: CanonicalItemRendererProps["presentation"];
  threadId?: string;
}): React.ReactNode {
  const [nowMs, setNowMs] = React.useState(Date.now);
  React.useEffect(() => {
    if (item.activity?.type !== "command" || !isActiveToolState(item.state)) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [item.activity?.type, item.state]);
  const view = React.useMemo(() => buildToolItemDisplay(item, nowMs), [item, nowMs]);
  const [localExpanded, setLocalExpanded] = React.useState(false);
  const requestedExpanded = disclosure?.expanded ?? localExpanded;
  const expanded = view.canExpand && requestedExpanded;
  const SummaryIcon = toolSemanticIcon(view.iconKind);
  const contentId = React.useId();

  React.useEffect(() => {
    if (view.canExpand || !requestedExpanded) return;
    if (disclosure) {
      disclosure.onExpandedChange(disclosure.id, false);
    } else {
      setLocalExpanded(false);
    }
  }, [disclosure, requestedExpanded, view.canExpand]);

  return (
    <div
      className="cpx-agent-activity__item"
      data-expandable={view.canExpand ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
      data-presentation={presentation}
      data-state={item.state}
    >
      <button
        aria-controls={view.canExpand ? contentId : undefined}
        aria-disabled={!view.canExpand}
        aria-expanded={view.canExpand ? expanded : undefined}
        className="cpx-agent-activity__item-header"
        onClick={() => {
          if (!view.canExpand) return;
          if (disclosure) {
            disclosure.onExpandedChange(disclosure.id, !expanded);
          } else {
            setLocalExpanded(!expanded);
          }
        }}
        type="button"
      >
        {view.active ? (
          <LoaderCircle className="canonical-spin cpx-agent-activity__icon" aria-hidden="true" />
        ) : item.state === "interrupted" ? (
          <CircleStop className="cpx-agent-activity__icon" aria-hidden="true" />
        ) : view.failed ? (
          <CircleAlert className="cpx-agent-activity__icon" aria-hidden="true" />
        ) : (
          <SummaryIcon className="cpx-agent-activity__icon" aria-hidden="true" />
        )}
        {view.semanticSummary ? (
          <ToolActivityLabel summary={view.semanticSummary} />
        ) : (
          <span className="cpx-agent-activity__label">
            {expanded ? view.expandedLabel : view.collapsedLabel}
          </span>
        )}
        <ChevronRight className="cpx-agent-activity__chevron" aria-hidden="true" />
      </button>
      <DisclosureContent
        contentClassName="cpx-agent-activity__details"
        expanded={expanded}
        id={contentId}
        mountPolicy="always"
      >
        <ToolExecutionCard item={item} presentation={presentation} threadId={threadId} view={view} />
      </DisclosureContent>
    </div>
  );
}

export function resolveShellTag(item: ToolItem): string {
  const rawTool = (item.tool ?? "").trim().toLowerCase();
  const toolLeaf = rawTool.split(/[./]/).at(-1) ?? "";

  // Check if input specifies shell
  if (item.input && typeof item.input === "object") {
    const inputObj = item.input as Record<string, unknown>;
    const shellField = typeof inputObj.shell === "string" ? inputObj.shell.toLowerCase() : "";
    if (shellField.includes("pwsh") || shellField.includes("powershell")) return "pwsh";
    if (shellField.includes("zsh")) return "zsh";
    if (shellField.includes("bash")) return "bash";
    if (shellField.includes("cmd")) return "cmd";
    if (shellField.includes("fish")) return "fish";
  }

  // Check command string prefix
  const command = (item.command ?? "").trim();
  if (/^pwsh(\.exe)?\b/i.test(command) || /^powershell(\.exe)?\b/i.test(command)) return "pwsh";
  if (/^bash\b/i.test(command)) return "bash";
  if (/^zsh\b/i.test(command)) return "zsh";
  if (/^cmd(\.exe)?\s*\/c\b/i.test(command)) return "cmd";

  // Check tool name
  if (toolLeaf === "zsh") return "zsh";
  if (toolLeaf === "pwsh" || toolLeaf === "powershell") return "pwsh";
  if (toolLeaf === "cmd") return "cmd";
  if (toolLeaf === "fish") return "fish";
  if (toolLeaf === "bash") return "bash";

  return "Shell";
}

export const ToolExecutionCard = React.memo(function ToolExecutionCard({
  item,
  presentation = "standalone",
  threadId,
  view,
}: {
  item: ToolItem;
  presentation?: CanonicalItemRendererProps["presentation"];
  threadId?: string;
  view: ToolItemDisplay;
}): React.ReactNode {
  const embedded = presentation === "grouped";
  const shellTag = resolveShellTag(item);
  return (
    <article
      className={`canonical-command-shell md-code-surface${embedded ? " canonical-command-shell--embedded" : ""}`}
      data-state={item.state}
    >
      <div className="canonical-command-shell__body">
        <CodeBlock
          surface="embedded"
          collapsible
          ariaLabel="执行内容"
          headerLabel={shellTag}
          copyLabel="复制执行内容"
          code={view.executionContent}
          language="text"
          streaming={view.active}
        />
        {view.resultText ? (
          <CodeBlock
            surface="embedded"
            ariaLabel="返回结果"
            headerLabel={null}
            copyLabel="复制返回结果"
            code={view.resultText}
            language="text"
            streaming={view.active}
            wrapContent={content => (
              <CommandShellEmbeddedScroll>{content}</CommandShellEmbeddedScroll>
            )}
          />
        ) : null}
        {item.resultBlocks?.length ? (
          <ToolResultBlocksView item={item} threadId={threadId} />
        ) : null}
      </div>
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
});

/**
 * 分组呈现时把 command shell 输出包进滚动边界 frame：内层负责滚动，
 * 外层顶部与底部伪元素按滚动状态显示固定的静态渐隐。
 */
function wrapEmbeddedOutput(
  embedded: boolean,
  output: React.ReactNode,
): React.ReactNode {
  return embedded
    ? <CommandShellEmbeddedScroll>{output}</CommandShellEmbeddedScroll>
    : output;
}

function ToolResultBlocksView({
  item,
  threadId,
}: {
  item: ToolItem;
  threadId?: string;
}): React.ReactNode {
  const blocks = item.resultBlocks ?? [];
  const filteredBlocks = blocks.filter((block) => {
    if (block.type === "json") {
      if (isProcessEnvelope(block.value)) {
        return false;
      }
    }
    if (block.type === "text") {
      if (isProcessEnvelope(block.text)) {
        return false;
      }
    }
    return true;
  });
  if (!filteredBlocks.length) return null;
  return (
    <section className="canonical-tool-result-blocks" aria-label="结构化返回结果">
      {filteredBlocks.map((block, index) => (
        <ToolResultBlockView
          block={block}
          itemId={item.id}
          key={`${item.id}:result-block:${index}`}
          threadId={threadId}
        />
      ))}
    </section>
  );
}

function ToolResultBlockView({
  block,
  itemId,
  threadId,
}: {
  block: ToolResultBlock;
  itemId: string;
  threadId?: string;
}): React.ReactNode {
  if (block.type === "json" && isProcessEnvelope(block.value)) {
    return null;
  }
  if (block.type === "text" && isProcessEnvelope(block.text)) {
    return null;
  }
  switch (block.type) {
    case "text":
      return (
        <pre className="canonical-tool-result-block canonical-tool-result-block--text">
          <code>{block.text}</code>
        </pre>
      );
    case "citation": {
      const url = safeCitationUrl(block.url);
      return (
        <div className="canonical-tool-result-block canonical-tool-result-block--citation">
          <Globe2 aria-hidden="true" size={APP_ICON_SIZE} />
          {url ? (
            <a href={url} rel="noopener noreferrer" target="_blank">
              {block.title ?? url}
            </a>
          ) : (
            <span>{block.title ?? block.url}</span>
          )}
        </div>
      );
    }
    case "json":
      return (
        <pre className="canonical-tool-result-block canonical-tool-result-block--json">
          <code>{formatUnknown(block.value)}</code>
        </pre>
      );
    case "artifact":
      return (
        <ToolArtifactBlockView
          block={block}
          itemId={itemId}
          threadId={threadId}
        />
      );
  }
}

function ToolArtifactBlockView({
  block,
  itemId,
  threadId,
}: {
  block: Extract<ToolResultBlock, { type: "artifact" }>;
  itemId: string;
  threadId?: string;
}): React.ReactNode {
  const isImage = /^image\//i.test(block.mimeType);
  const detail = `${block.mimeType}${block.size !== undefined ? ` · ${formatArtifactByteSize(block.size)}` : ""}`;
  if (isImage) {
    return <ToolArtifactImageBlock block={block} itemId={itemId} threadId={threadId} />;
  }
  return (
    <div className="canonical-tool-result-block canonical-tool-result-block--artifact">
      <AttachmentFilePill detail={detail} name={block.name} />
    </div>
  );
}

function ToolArtifactImageBlock({
  block,
  itemId,
  threadId,
}: {
  block: Extract<ToolResultBlock, { type: "artifact" }>;
  itemId: string;
  threadId?: string;
}): React.ReactNode {
  const state = useToolArtifactImageSource(threadId, block.artifactId, block.mimeType);
  return (
    <div className="canonical-tool-result-block canonical-tool-result-block--artifact" data-item-id={itemId}>
      <AttachmentImageTile
        errorMessage={state.status === "error" ? state.message : undefined}
        name={block.name}
        source={state.status === "ready" ? state.source : undefined}
        status={state.status}
      />
    </div>
  );
}

function safeCitationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function formatArtifactByteSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CommandShellEmbeddedScroll({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const edge = useScrollEdgeState(scrollerRef, { contentRef });
  return (
    <div
      className="canonical-command-shell__edge-fade"
      data-at-end={edge.atEnd}
      data-at-start={edge.atStart}
      data-scrollable={edge.scrollable}
    >
      <div className="canonical-command-shell__scroller" ref={scrollerRef}>
        <div className="canonical-command-shell__scroll-content" ref={contentRef}>
          {children}
        </div>
      </div>
    </div>
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
  const visibleFiles = patchFilesForDisplay(patch.files, false);
  const hiddenFiles = patch.files.slice(visibleFiles.length);
  const filesDisclosureId = React.useId();
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
            <Button color="primary"
              className="canonical-patch-card__action"
              loading={pendingAction === patchAction}
              onClick={() => void applyPatch()}
            >
              <RotateCcw aria-hidden="true" size={APP_ICON_SIZE} />
              {patchAction === "undo" ? "撤销" : "重新应用"}
            </Button>
          ) : null}
          {onOpenReview ? (
            <Button color="secondary"
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
          <PatchFileButton file={file} key={file.path} onOpenReview={onOpenReview} />
        ))}
        <DisclosureContent
          expanded={filesExpanded}
          id={filesDisclosureId}
          mountPolicy="always"
        >
          {hiddenFiles.map((file) => (
            <PatchFileButton file={file} key={file.path} onOpenReview={onOpenReview} />
          ))}
        </DisclosureContent>
      </div>
      {hiddenFileCount > 0 ? (
        <button
          aria-controls={filesDisclosureId}
          aria-expanded={filesExpanded}
          className="canonical-patch-card__disclosure"
          type="button"
          onClick={() => setFilesExpanded((expanded) => !expanded)}
        >
          {filesExpanded ? "收起文件" : `再显示 ${hiddenFileCount} 个文件`}
          {filesExpanded ? (
            <ChevronDown aria-hidden="true" className="is-expanded" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
        </button>
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
  disclosureStore,
  item,
  readThreadPatchDiff,
  threadId,
}: {
  diffMarkerStyle?: DesktopDiffMarkerStyle;
  disclosureStore?: KeyedDisclosureStore;
  item: ToolItem;
  readThreadPatchDiff?: ReadThreadPatchDiff;
  threadId?: string;
}): React.ReactNode {
  const mutation = fileMutationDisplay(item);
  if (!mutation) return null;
  const active = isActiveToolState(item.state);
  const failed = item.state === "error" || item.state === "interrupted";

  return (
    <div className="cpx-agent-activity__file-changes" data-state={item.state}>
      {mutation.files.map((file, fileIndex) => {
        const disclosureId = `file-mutation:${item.id}:${fileIndex}`;
        const canExpand =
          item.state === "completed" &&
          Boolean(disclosureStore) &&
          Boolean(threadId) &&
          Boolean(readThreadPatchDiff) &&
          item.mutationDiffPaths?.some((path) => sameMutationPath(path, file.path)) === true;
        if (!canExpand || !readThreadPatchDiff || !threadId) {
          return (
            <div
              className="cpx-agent-activity__item-header cpx-agent-activity__item-header--static"
              key={`${item.id}:${file.path}`}
            >
              {active ? (
                <LoaderCircle className="canonical-spin cpx-agent-activity__icon" aria-hidden="true" />
              ) : failed ? (
                <CircleAlert className="cpx-agent-activity__icon" aria-hidden="true" />
              ) : (
                <Pencil className="cpx-agent-activity__icon" aria-hidden="true" />
              )}
              <span className="cpx-agent-activity__label" title={file.path}>{fileMutationLabel(item.state, file.path, file.operation)}</span>
              <span className="cpx-agent-activity__review-indicator">
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
        if (!disclosureStore) return null;
        return (
          <React.Suspense
            fallback={(
              <div className="cpx-agent-activity__item-header cpx-agent-activity__item-header--static">
                <Pencil className="cpx-agent-activity__icon" aria-hidden="true" />
                <span className="cpx-agent-activity__label" title={file.path}>{fileMutationLabel(item.state, file.path, file.operation)}</span>
                <span className="cpx-agent-activity__review-indicator">
                  {file.additions !== null ? <small className="canonical-diff-add">+{file.additions}</small> : null}
                  {file.deletions !== null ? <small className="canonical-diff-remove">-{file.deletions}</small> : null}
                </span>
              </div>
            )}
            key={`${item.id}:${file.path}`}
          >
            <LazyExpandableFileMutationRow
              diffMarkerStyle={diffMarkerStyle}
              disclosure={{ id: disclosureId, store: disclosureStore }}
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
  className,
  text,
}: {
  ariaLabel?: string;
  className?: string;
  text: string;
}): React.ReactNode {
  const [copied, setCopied] = React.useState(false);
  return (
    <Tooltip content={copied ? "已复制" : ariaLabel}>
      <IconButton
        aria-label={copied ? `${ariaLabel}：已复制` : ariaLabel}
        className={className}
        color="ghostSecondary"
        size="toolbar"
        title={copied ? "已复制" : ariaLabel}
        onClick={(event) => {
          event.stopPropagation();
          void desktopClipboard.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        {copied ? <Check aria-hidden="true" size={APP_ICON_SIZE} /> : <Copy aria-hidden="true" size={APP_ICON_SIZE} />}
      </IconButton>
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

export function buildToolItemDisplay(item: ToolItem, nowMs?: number): ToolItemDisplay {
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
      iconKind: "tool",
      resultText: null,
      semanticSummary: null,
      statusLabel: toolStateLabel(item.state),
      semanticKind: "tool",
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
  const rawResultText = structuredDetail
    ? structuredDetail.resultText
    : appendToolError(nonBlank(item.output), nonBlank(item.error));
  const resultText = cleanCommandOutput(rawResultText);
  const active = isActiveToolState(item.state);
  const terminal = !active;
  const semanticSummary = buildToolSemanticSummary(item, { nowMs });

  return {
    active,
    canExpand: terminal || resultText !== null,
    collapsedLabel: semanticSummary.collapsedLabel,
    executionContent,
    expandedLabel: semanticSummary.expandedLabel,
    failed: item.state === "error" || item.state === "interrupted",
    iconKind: semanticSummary.iconKind,
    resultText,
    semanticSummary,
    statusLabel: toolStateLabel(item.state),
    semanticKind: semanticSummary.kind,
    toolLabel: semanticSummary.toolLabel,
  };
}

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

/**
 * 深度检测某个值是否为底层进程执行包装（exitCode / exit_code / stdout / stderr / signal / timedOut / truncated 等）。
 * 适用于对象、嵌套对象、JSON 字符串以及 Markdown 代码块格式。
 */
export function isProcessEnvelope(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const cleanStr = trimmed.startsWith("```")
      ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
      : trimmed;
    if (cleanStr.startsWith("{") && cleanStr.endsWith("}")) {
      try {
        const parsed = JSON.parse(cleanStr);
        return isProcessEnvelope(parsed);
      } catch {
        // fall through to text heuristic
      }
    }
    if (
      (cleanStr.includes('"exitCode"') || cleanStr.includes('"exit_code"') || cleanStr.includes("exitCode:") || cleanStr.includes("exit_code:"))
      && (cleanStr.includes('"stdout"') || cleanStr.includes('"stderr"') || cleanStr.includes('"signal"') || cleanStr.includes('"timedOut"') || cleanStr.includes("stdout:") || cleanStr.includes("stderr:"))
    ) {
      return true;
    }
    return false;
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.length > 0 && value.every((item) => isProcessEnvelope(item));
    }
    const rec = value as Record<string, unknown>;
    if (
      "exitCode" in rec
      || "exit_code" in rec
      || "returncode" in rec
      || "return_code" in rec
      || "timedOut" in rec
      || "timed_out" in rec
      || "truncated" in rec
      || ("stdout" in rec && ("stderr" in rec || "signal" in rec))
    ) {
      return true;
    }
    if (rec.result && typeof rec.result === "object" && isProcessEnvelope(rec.result)) {
      return true;
    }
  }
  return false;
}

export function isShellTool(tool: string | null | undefined): boolean {
  if (!tool) return false;
  const leaf = tool.split(/[./]/).at(-1)?.toLowerCase() ?? "";
  return /^(shell|bash|powershell|pwsh|cmd|exec|terminal|command|run_command|execute_command)/i.test(leaf);
}

/**
 * 清洗工具执行输出：
 * 若输出为底层进程通信包装的 JSON（含 exitCode / stdout / stderr / timedOut 等），
 * 则智能提取出真实的 stdout / stderr 内容，彻底杜绝在终端卡片中露出内部 JSON 结构。
 */
export function cleanCommandOutput(rawText: string | null): string | null {
  const text = nonBlank(rawText);
  if (!text) return null;
  const trimmed = text.trim();
  const cleanStr = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    : trimmed;
  if (cleanStr.startsWith("{") && cleanStr.endsWith("}")) {
    try {
      const parsed = JSON.parse(cleanStr);
      if (isProcessEnvelope(parsed)) {
        const stdout = typeof parsed.stdout === "string" ? parsed.stdout.trim() : "";
        const stderr = typeof parsed.stderr === "string" ? parsed.stderr.trim() : "";
        const combined = [stdout, stderr].filter(Boolean).join("\n");
        return combined || null;
      }
    } catch {
      // 保持原样文本
    }
  }
  return text;
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
          ...(record.operation === "write"
            || record.operation === "create"
            || record.operation === "update"
            || record.operation === "delete"
            ? { operation: record.operation }
            : {}),
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
      ...(file.operation ?? current?.operation
        ? { operation: file.operation ?? current?.operation }
        : {}),
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
  const activityFiles: FileChangeDisplay[] = item.activity?.type === "file_change"
    ? item.activity.changes.map((change) => ({
        additions: nonNegativeInteger(change.additions),
        deletions: nonNegativeInteger(change.deletions),
        operation: change.operation,
        path: change.path,
      }))
    : [];
  let files = mergeFileCandidates(
    activityFiles,
    mergeFileCandidates(
      fileCandidates(output.files),
      fileCandidates(input.affectedPaths ?? input.files),
    ),
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
      ...(files[0].operation ? { operation: files[0].operation } : {}),
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

export function fileMutationLabel(
  state: ToolItem["state"],
  path: string,
  operation: FileChangeDisplay["operation"] = "update",
): string {
  const action = operation === "create"
    ? "创建"
    : operation === "delete"
      ? "删除"
      : "编辑";
  if (state === "completed") return `已${action} ${path}`;
  if (state === "error") return `${action}失败 ${path}`;
  if (state === "interrupted") return `已停止${action} ${path}`;
  return `正在${action} ${path}`;
}

function PatchFileButton({
  file,
  onOpenReview,
}: {
  file: FileChangeDisplay;
  onOpenReview?: CanonicalItemRendererProps["onOpenPatchReview"];
}): React.ReactNode {
  return (
    <button
      className="canonical-patch-card__file"
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
  );
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
