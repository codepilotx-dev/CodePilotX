import React from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { RenderBlocker, RenderTurnEntry } from "@codepilotx/session-view";
import type { Item } from "@codepilotx/shared/thread";
import type { VirtualizerHandle } from "virtua";

import {
  CanonicalItemRenderer,
  CanonicalUserInput,
  type CanonicalItemRendererProps,
} from "./CanonicalItemRenderer.js";
import { ConversationTurnErrorBoundary } from "../conversation/ConversationTurnErrorBoundary.js";
import {
  SessionTimelineView,
  type ThreadTimelineNavigationHandle,
} from "./SessionTimelineView.js";
import {
  summarizeCommandItems,
  summarizeTurnProcessItems,
  type ProcessSummary,
} from "./summarizeProcessItems.js";
import {
  loadTimelineDisclosureState,
  setTimelineDisclosureExpanded,
} from "./timelineDisclosureState.js";
import type { OpenPlanInDockRequest } from "../workflow/WorkflowPlanCard.js";

type ToolItem = Extract<Item, { type: "tool" }>;
type NonToolProcessItem = Exclude<Item, { type: "tool" }>;

export type ProcessSegment =
  | { kind: "commands"; id: string; items: ToolItem[] }
  | { kind: "item"; id: string; item: NonToolProcessItem };

export type TimelineDisclosureProps = ProcessSummary & {
  children: React.ReactNode;
  disclosureId: string;
  expanded: boolean;
  onExpandedChange: (id: string, expanded: boolean) => void;
  variant: "turn" | "commands";
};

export type CanonicalThreadViewProps = {
  turns: RenderTurnEntry[];
  threadId: string;
  active: boolean;
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  error: string | null;
  initialScrollOffset?: number;
  listRef: React.RefObject<VirtualizerHandle | null>;
  navigationRef: React.Ref<ThreadTimelineNavigationHandle>;
  scrollRef: React.RefObject<HTMLElement | null>;
  onScroll?: (scrollTop: number) => void;
  onLoadOlder: () => Promise<void>;
  onReload: () => Promise<void>;
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  rightDockPlanEventId: string | null;
};

/**
 * Controlled disclosure shared by the outer turn process and nested command
 * groups. Active groups stay open without writing that forced state to storage.
 */
export function CanonicalProcessGroup({
  active,
  failed,
  label,
  children,
  disclosureId,
  expanded: persistedExpanded,
  onExpandedChange,
  variant,
}: TimelineDisclosureProps): React.ReactNode {
  const forcedOpen = active;
  const expanded = forcedOpen || persistedExpanded;
  const datastate = active ? "active" : failed ? "failed" : "completed";

  return (
    <details
      className={`canonical-process-group canonical-process-group--${variant}`}
      data-state={datastate}
      data-disclosure-id={disclosureId}
      onToggle={(event) => {
        if (forcedOpen) {
          if (!event.currentTarget.open) event.currentTarget.open = true;
          return;
        }
        onExpandedChange(disclosureId, event.currentTarget.open);
      }}
      open={expanded}
    >
      <summary>
        {active ? (
          <LoaderCircle className="canonical-spin" aria-hidden="true" />
        ) : failed ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        <span>{label}</span>
        {expanded ? (
          <ChevronDown className="canonical-process-group__chevron" aria-hidden="true" />
        ) : (
          <ChevronRight className="canonical-process-group__chevron" aria-hidden="true" />
        )}
      </summary>
      {expanded ? (
        <div className="canonical-process-group__items">
          {children}
        </div>
      ) : null}
    </details>
  );
}

export function segmentProcessItems(items: readonly Item[]): ProcessSegment[] {
  const segments: ProcessSegment[] = [];

  for (const item of items) {
    if (item.type !== "tool") {
      segments.push({ kind: "item", id: `item:${item.id}`, item });
      continue;
    }

    const previous = segments.at(-1);
    if (previous?.kind === "commands") {
      previous.items.push(item);
      continue;
    }
    segments.push({
      kind: "commands",
      id: `commands:${item.id}`,
      items: [item],
    });
  }

  return segments;
}

export function useTimelineDisclosureState(threadId: string): {
  expandedIds: ReadonlySet<string>;
  onExpandedChange: (id: string, expanded: boolean) => void;
} {
  const [state, setState] = React.useState<{
    threadId: string;
    expandedIds: Set<string>;
  }>(() => ({
    threadId,
    expandedIds: loadTimelineDisclosureState(threadId),
  }));
  const expandedIds = state.threadId === threadId
    ? state.expandedIds
    : loadTimelineDisclosureState(threadId);

  React.useEffect(() => {
    if (state.threadId === threadId) return;
    setState({ threadId, expandedIds });
  }, [expandedIds, state.threadId, threadId]);

  const onExpandedChange = React.useCallback(
    (id: string, expanded: boolean): void => {
      const next = setTimelineDisclosureExpanded(threadId, id, expanded);
      setState({ threadId, expandedIds: next });
    },
    [threadId],
  );

  return { expandedIds, onExpandedChange };
}

export function CanonicalThreadView({
  turns,
  threadId,
  active,
  loading,
  loadingOlder,
  hasOlder,
  error,
  initialScrollOffset,
  listRef,
  navigationRef,
  scrollRef,
  onScroll,
  onLoadOlder,
  onReload,
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
}: CanonicalThreadViewProps): React.ReactNode {
  const disclosureState = useTimelineDisclosureState(threadId);
  const loadOlderPreservingAnchor = React.useCallback(async (): Promise<void> => {
    const handle = listRef.current;
    const previousSize = handle?.scrollSize ?? 0;
    const previousOffset = handle?.scrollOffset ?? scrollRef.current?.scrollTop ?? 0;
    await onLoadOlder();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const nextHandle = listRef.current;
        if (!nextHandle || previousSize <= 0) return;
        const delta = Math.max(0, nextHandle.scrollSize - previousSize);
        nextHandle.scrollTo(previousOffset + delta);
      });
    });
  }, [listRef, onLoadOlder, scrollRef]);

  if (loading && turns.length === 0) {
    return (
      <div className="canonical-thread-state" role="status" aria-live="polite">
        <LoaderCircle className="canonical-spin" aria-hidden="true" />
        <span>正在加载会话</span>
      </div>
    );
  }

  if (error && turns.length === 0) {
    return (
      <div className="canonical-thread-state canonical-thread-state--error" role="alert">
        <CircleAlert aria-hidden="true" />
        <span><strong>无法加载会话</strong><small>{error}</small></span>
        <button type="button" onClick={() => void onReload()}>
          <RotateCcw aria-hidden="true" />重试
        </button>
      </div>
    );
  }

  return (
    <div className="canonical-thread-view">
      {hasOlder ? (
        <div className="canonical-history-control">
          <button
            type="button"
            disabled={loadingOlder}
            onClick={() => void loadOlderPreservingAnchor()}
          >
            {loadingOlder ? <LoaderCircle className="canonical-spin" aria-hidden="true" /> : null}
            {loadingOlder ? "正在加载" : "加载更早的对话"}
          </button>
        </div>
      ) : null}
      <SessionTimelineView
        key={threadId}
        count={turns.length}
        initialScrollOffset={initialScrollOffset}
        listRef={listRef}
        navigationRef={navigationRef}
        onScroll={onScroll}
        scrollRef={scrollRef}
        scrollToBottom={active}
        sessionKey={threadId}
      >
        {turns.map((entry) => (
          <div
            className="session-turn-row canonical-turn-row tw:mx-auto tw:w-full tw:max-w-[48rem] tw:min-w-0"
            data-component="conversation-turn"
            data-turn-navigation-id={entry.id}
            key={entry.id}
          >
            <ConversationTurnErrorBoundary turnId={entry.id}>
              <CanonicalConversationTurn
                disclosureState={disclosureState}
                entry={entry}
                onOpenPlanInRightDock={onOpenPlanInRightDock}
                onOpenSubagent={onOpenSubagent}
                rightDockPlanEventId={rightDockPlanEventId}
              />
            </ConversationTurnErrorBoundary>
          </div>
        ))}
      </SessionTimelineView>
    </div>
  );
}

export function CanonicalConversationTurn({
  disclosureState,
  entry,
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
}: {
  disclosureState: {
    expandedIds: ReadonlySet<string>;
    onExpandedChange: (id: string, expanded: boolean) => void;
  };
  entry: RenderTurnEntry;
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  rightDockPlanEventId: string | null;
}): React.ReactNode {
  const disclosure = (id: string) => ({
    id,
    expanded: disclosureState.expandedIds.has(id),
    onExpandedChange: disclosureState.onExpandedChange,
  });
  const renderItem = (
    item: RenderTurnEntry["items"][number],
    options: {
      disclosureId?: string;
      presentation?: CanonicalItemRendererProps["presentation"];
    } = {},
  ) => (
    <CanonicalItemRenderer
      disclosure={options.disclosureId ? disclosure(options.disclosureId) : undefined}
      item={item}
      key={item.id}
      onOpenPlanInRightDock={onOpenPlanInRightDock}
      onOpenSubagent={onOpenSubagent}
      presentation={options.presentation}
      rightDockPlanEventId={rightDockPlanEventId}
    />
  );
  const active = isActiveTurn(entry.turn.status);
  const hasAssistantResult = entry.assistantResultItems.some((item) => item.text.trim());
  const segments = segmentProcessItems(entry.processItems);
  const lastCommandSegmentIndex = segments.findLastIndex(
    (segment) => segment.kind === "commands",
  );
  const turnProcessId = `turn-process:${entry.turn.id}`;
  const turnProcessSummary = summarizeTurnProcessItems(
    entry.processItems,
    entry.turn.status,
    entry.turn.elapsedSeconds,
  );

  return (
    <article className="canonical-turn" data-status={entry.turn.status}>
      {entry.userItems.length ? (
        <section className="canonical-turn__user" aria-label="用户消息">
          {entry.userItems.map((input) => (
            <CanonicalUserInput
              attachments={entry.attachments.filter((attachment) => input.attachmentIds?.includes(attachment.id))}
              input={input}
              key={input.id}
            />
          ))}
        </section>
      ) : null}
      {entry.processItems.length > 0 ? (
        <section className="canonical-turn__process" aria-label="处理过程">
          <CanonicalProcessGroup
            {...turnProcessSummary}
            disclosureId={turnProcessId}
            expanded={disclosureState.expandedIds.has(turnProcessId)}
            onExpandedChange={disclosureState.onExpandedChange}
            variant="turn"
          >
            {segments.map((segment, segmentIndex) => {
              if (segment.kind === "item") {
                return renderItem(segment.item, { presentation: "grouped" });
              }
              const commandGroupId = `command-group:${entry.turn.id}:${segment.items[0].id}`;
              const summary = summarizeCommandItems(
                segment.items,
                active && segmentIndex === lastCommandSegmentIndex
                  ? entry.turn.status
                  : "completed",
              );
              return (
                <CanonicalProcessGroup
                  {...summary}
                  disclosureId={commandGroupId}
                  expanded={disclosureState.expandedIds.has(commandGroupId)}
                  key={segment.id}
                  onExpandedChange={disclosureState.onExpandedChange}
                  variant="commands"
                >
                  {segment.items.map((item) => renderItem(item, {
                    disclosureId: `tool:${entry.turn.id}:${item.id}`,
                    presentation: "grouped",
                  }))}
                </CanonicalProcessGroup>
              );
            })}
          </CanonicalProcessGroup>
        </section>
      ) : null}
      {entry.blockers.length ? (
        <section className="canonical-turn__blockers" aria-label="等待处理">
          {entry.blockers.map((blocker) => (
            <CanonicalBlocker
              blocker={blocker}
              key={blocker.id}
              renderItem={renderItem}
            />
          ))}
        </section>
      ) : null}
      {entry.planItem ? (
        <section className="canonical-turn__plan">
          {renderItem(entry.planItem)}
        </section>
      ) : null}
      {entry.assistantResultItems.length > 0 ? (
        <section className="canonical-turn__result" aria-label="助手回复">
          {entry.assistantResultItems.map((item) => renderItem(item))}
        </section>
      ) : null}
      {entry.patchItems.length > 0 ? (
        <section className="canonical-turn__post" aria-label="文件更改">
          {entry.patchItems.map((item) => renderItem(item))}
        </section>
      ) : null}
      {entry.postAssistantItems.length > 0 ? (
        <section className="canonical-turn__post">
          {entry.postAssistantItems.map((item) => renderItem(item))}
        </section>
      ) : null}
      {/* Only show fallback thinking when there are no process items to display it on */}
      {active && !hasAssistantResult && entry.processItems.length === 0 ? (
        <div className="canonical-turn__thinking" role="status" aria-live="polite">
          <LoaderCircle className="canonical-spin" aria-hidden="true" />
          <span>正在处理</span>
        </div>
      ) : null}
      {entry.turn.error ? (
        <div className="canonical-turn__status canonical-turn__status--error">
          <CircleAlert aria-hidden="true" />
          <span>{entry.turn.error}</span>
        </div>
      ) : null}
    </article>
  );
}

function CanonicalBlocker({
  blocker,
  renderItem,
}: {
  blocker: RenderBlocker;
  renderItem: (item: RenderTurnEntry["items"][number]) => React.ReactNode;
}): React.ReactNode {
  if (blocker.kind === "question") return renderItem(blocker.question);
  return (
    <article className="canonical-blocker-card" data-state={blocker.approval.status}>
      <header>
        <CircleAlert aria-hidden="true" />
        <strong>{blocker.approval.tool} 需要授权</strong>
      </header>
      <p>{blocker.approval.reason}</p>
    </article>
  );
}

function isActiveTurn(status: RenderTurnEntry["turn"]["status"]): boolean {
  return status === "running"
    || status === "waiting-permission"
    || status === "waiting-question"
    || status === "waiting-subagents";
}
