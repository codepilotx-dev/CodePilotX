import React from "react";
import { CircleAlert, LoaderCircle, RotateCcw } from "lucide-react";
import type { RenderBlocker, RenderTurnEntry } from "@codepilotx/session-view";
import type { VirtualizerHandle } from "virtua";

import {
  CanonicalItemRenderer,
  CanonicalUserInput,
} from "./CanonicalItemRenderer.js";
import { ConversationTurnErrorBoundary } from "./ConversationTurnErrorBoundary.js";
import { SessionTimelineView } from "./SessionTimelineView.js";
import type { OpenPlanInDockRequest } from "./WorkflowPlanCard.js";

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
  scrollRef: React.RefObject<HTMLElement | null>;
  onScroll?: (scrollTop: number) => void;
  onLoadOlder: () => Promise<void>;
  onReload: () => Promise<void>;
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  rightDockPlanEventId: string | null;
};

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
  scrollRef,
  onScroll,
  onLoadOlder,
  onReload,
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
}: CanonicalThreadViewProps): React.ReactNode {
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
        count={turns.length}
        initialScrollOffset={initialScrollOffset}
        listRef={listRef}
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
  entry,
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
}: {
  entry: RenderTurnEntry;
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  rightDockPlanEventId: string | null;
}): React.ReactNode {
  const renderItem = (item: RenderTurnEntry["items"][number]) => (
    <CanonicalItemRenderer
      item={item}
      key={item.id}
      onOpenPlanInRightDock={onOpenPlanInRightDock}
      onOpenSubagent={onOpenSubagent}
      rightDockPlanEventId={rightDockPlanEventId}
    />
  );
  const active = isActiveTurn(entry.turn.status);
  const hasAssistantResult = entry.assistantResultItems.some((item) => item.text.trim());

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
      {entry.processItems.length ? (
        <section className="canonical-turn__process" aria-label="执行过程">
          {entry.processItems.map(renderItem)}
        </section>
      ) : null}
      {entry.planItem ? (
        <section className="canonical-turn__plan">
          {renderItem(entry.planItem)}
        </section>
      ) : null}
      {entry.assistantResultItems.length ? (
        <section className="canonical-turn__result" aria-label="助手回复">
          {entry.assistantResultItems.map(renderItem)}
        </section>
      ) : null}
      {entry.patchItems.length ? (
        <section className="canonical-turn__post" aria-label="文件更改">
          {entry.patchItems.map(renderItem)}
        </section>
      ) : null}
      {entry.postAssistantItems.length ? (
        <section className="canonical-turn__post">
          {entry.postAssistantItems.map(renderItem)}
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
      {active && !hasAssistantResult ? (
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
  if (blocker.kind === "plan") return null;
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
    || status === "waiting-plan-confirmation"
    || status === "waiting-subagents";
}
