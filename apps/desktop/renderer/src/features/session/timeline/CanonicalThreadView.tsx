import React from "react";
import {
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { RenderBlocker, RenderTurnEntry } from "@codepilotx/session-view";
import type { Item } from "@codepilotx/shared/thread";
import type { DesktopDiffMarkerStyle } from "../../../../shared/types.js";
import type { VirtualizerHandle } from "virtua";
import { FullScreenWhaleLoading } from "../../../components/ui/FullScreenWhaleLoading.js";

import {
  CanonicalItemRenderer,
  CanonicalUserInput,
  FileMutationItemView,
  isFileMutationTool,
  isStandaloneLifecycleTool,
  LifecycleToolItemView,
  PatchSummaryView,
  syntheticPatchDisplay,
  toolSemanticIcon,
  type CanonicalItemRendererProps,
  type PatchAction,
  type ReadThreadPatchDiff,
} from "./CanonicalItemRenderer.js";
import { ConversationTurnErrorBoundary } from "../conversation/ConversationTurnErrorBoundary.js";
import {
  SessionTimelineView,
  type ThreadTimelineNavigationHandle,
} from "./SessionTimelineView.js";
import {
  isProcessItemActive,
  summarizeTurnProcessItems,
  summarizeTurnWork,
  type ProcessSummary,
  type ProcessSemanticKind,
  type TurnWorkSummary,
} from "./summarizeProcessItems.js";
import {
  loadTimelineDisclosureState,
  setTimelineDisclosureExpanded,
} from "./timelineDisclosureState.js";
import type { OpenPlanInDockRequest } from "../workflow/WorkflowPlanCard.js";
import type { RegisterConversationTurnRow } from "../conversation/useConversationTurnRowVisibility.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";
import { useScrollEdgeState } from "../../../hooks/useScrollEdgeState.js";
import {
  enterTween,
  exitTween,
  layoutTween,
  motionTransition,
} from "../../motion/motionTransitions.js";

export type ProcessActivityProjection =
  | { kind: "groupable"; item: Item }
  | { kind: "standalone"; item: Item }
  | { kind: "summary-only"; item: Extract<Item, { type: "reasoning" }> };

export type ProcessUnit =
  | { kind: "group"; key: string; items: Item[] }
  | { kind: "activity"; key: string; item: Item }
  | { kind: "standalone"; key: string; item: Item };

export type ProcessActivityModel = {
  activeGroupKey: string | null;
  showThinkingFallback: boolean;
  units: ProcessUnit[];
};

type RawProcessUnit =
  | { kind: "group"; key: string; items: Item[] }
  | { kind: "standalone"; key: string; item: Item };

export type TimelineDisclosureProps = ProcessSummary & {
  canExpand?: boolean;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
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
  layoutResizeActive?: boolean;
  listRef: React.RefObject<VirtualizerHandle | null>;
  navigationRef: React.Ref<ThreadTimelineNavigationHandle>;
  scrollRef: React.RefObject<HTMLElement | null>;
  onScroll?: (scrollTop: number) => void;
  onCanReturnToBottomChange: (canReturnToBottom: boolean) => void;
  onLoadOlder: () => Promise<void>;
  onReload: () => Promise<void>;
  onApplyPatch?: (
    itemId: string,
    action: PatchAction,
    expectedVersion: number,
  ) => Promise<void>;
  onOpenPatchReview?: (path?: string) => void;
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  registerTurnRow?: RegisterConversationTurnRow;
  rightDockPlanEventId: string | null;
  diffMarkerStyle?: DesktopDiffMarkerStyle;
  readThreadPatchDiff?: ReadThreadPatchDiff;
};

const PROCESS_SUMMARY_DEFER_MS = 1_000;

export function CanonicalProcessGroup({
  active,
  canExpand = true,
  children,
  defaultExpanded = false,
  failed,
  kind,
  label,
  summaryKey,
}: TimelineDisclosureProps): React.ReactNode {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const reducedMotion = usePrefersReducedMotion();
  const contentId = React.useId();
  const itemsRef = React.useRef<HTMLDivElement | null>(null);
  const itemsContentRef = React.useRef<HTMLDivElement | null>(null);
  const edge = useScrollEdgeState(itemsRef, {
    contentRef: itemsContentRef,
    version: expanded ? children : undefined,
  });
  const visibleLabel = useDeferredProcessSummary(label, summaryKey, active);
  const datastate = active ? "active" : failed ? "failed" : "completed";
  const SummaryIcon = processSummaryIcon(active ? "thinking" : failed ? "failed" : kind);
  const summaryContent = (
    <>
      {active ? (
        <LoaderCircle className="canonical-spin" aria-hidden="true" />
      ) : failed ? (
        <CircleAlert aria-hidden="true" />
      ) : (
        <SummaryIcon aria-hidden="true" />
      )}
      <span>{visibleLabel}</span>
      {canExpand ? (
        <ChevronRight className="canonical-process-group__chevron" aria-hidden="true" />
      ) : null}
    </>
  );

  return (
    <motion.div
      className="canonical-process-group canonical-process-group--turn"
      data-expandable={canExpand ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
      data-state={datastate}
      layout="position"
      transition={motionTransition(reducedMotion, layoutTween)}
    >
      {canExpand ? (
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          aria-label={visibleLabel || "处理过程"}
          className="canonical-process-group__summary"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {summaryContent}
        </button>
      ) : (
        <div
          aria-live={active ? "polite" : undefined}
          className="canonical-process-group__summary"
          role={active ? "status" : undefined}
        >
          {summaryContent}
        </div>
      )}
      <AnimatePresence initial={false} mode="popLayout">
        {canExpand && expanded ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="canonical-process-group__content"
            exit={{
              opacity: 0,
              pointerEvents: "none",
              transition: motionTransition(reducedMotion, exitTween),
              y: -4,
            }}
            id={contentId}
            initial={{ opacity: 0, y: -4 }}
            transition={motionTransition(reducedMotion, enterTween)}
          >
            <div
              className="canonical-process-edge-fade"
              data-at-end={edge.atEnd}
              data-at-start={edge.atStart}
              data-scrollable={edge.scrollable}
            >
              <div className="canonical-process-group__items" ref={itemsRef}>
                <div className="canonical-process-group__items-content" ref={itemsContentRef}>
                  {children}
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function processSummaryIcon(kind: ProcessSemanticKind): LucideIcon {
  if (kind === "thinking") return LoaderCircle;
  if (kind === "failed") return CircleAlert;
  return toolSemanticIcon(kind);
}

function useDeferredProcessSummary(
  label: string,
  summaryKey: string,
  defer: boolean,
): string {
  const [visible, setVisible] = React.useState(() => ({ label, summaryKey }));
  const lastCommitAt = React.useRef(Date.now());

  React.useEffect(() => {
    if (visible.summaryKey === summaryKey) return;
    const commit = (): void => {
      lastCommitAt.current = Date.now();
      setVisible({ label, summaryKey });
    };
    if (!defer) {
      commit();
      return;
    }
    const remaining = PROCESS_SUMMARY_DEFER_MS - (Date.now() - lastCommitAt.current);
    if (remaining <= 0) {
      commit();
      return;
    }
    const timeout = window.setTimeout(commit, remaining);
    return () => window.clearTimeout(timeout);
  }, [defer, label, summaryKey, visible.summaryKey]);

  return defer && visible.summaryKey !== summaryKey ? visible.label : label;
}

function groupProcessItems(
  items: readonly Item[],
): RawProcessUnit[] {
  const units: RawProcessUnit[] = [];
  let pendingItems: Item[] = [];
  const flush = (): void => {
    const [single] = pendingItems;
    if (!single) return;
    units.push({
      kind: "group",
      key: `process-group:${single.id}`,
      items: pendingItems,
    });
    pendingItems = [];
  };

  for (const item of items) {
    const projection = projectProcessItem(item);
    switch (projection.kind) {
      case "groupable":
        pendingItems.push(projection.item);
        break;
      case "summary-only":
        break;
      case "standalone":
        flush();
        units.push({
          kind: "standalone",
          key: `process-standalone:${projection.item.id}`,
          item: projection.item,
        });
        break;
    }
  }
  flush();
  return units;
}

export function buildProcessActivityModel(
  items: readonly Item[],
  {
    activitySliceClosed,
    hasBlockingRequest = false,
    turnActive,
  }: {
    activitySliceClosed: boolean;
    hasBlockingRequest?: boolean;
    turnActive: boolean;
  },
): ProcessActivityModel {
  const rawUnits = groupProcessItems(items);
  const lastUnitIndex = rawUnits.length - 1;
  const sliceActive = turnActive && !activitySliceClosed;
  let activeGroupKey: string | null = null;

  const units = rawUnits.map((unit, unitIndex): ProcessUnit => {
    if (unit.kind === "standalone") return unit;
    const [single] = unit.items;
    const isLatestActiveUnit = sliceActive && unitIndex === lastUnitIndex;
    const containsActiveItem = unit.items.some(isProcessItemActive);
    if (isLatestActiveUnit) activeGroupKey = unit.key;
    if (
      single
      && unit.items.length === 1
      && !containsActiveItem
      && !isLatestActiveUnit
    ) {
      return {
        kind: "activity",
        key: `process-item:${single.id}`,
        item: single,
      };
    }
    return unit;
  });

  const lastUnit = rawUnits.at(-1);
  const showThinkingFallback = sliceActive && !hasBlockingRequest && (
    !lastUnit
    || (lastUnit.kind === "standalone" && !isProcessItemActive(lastUnit.item))
  );

  return { activeGroupKey, showThinkingFallback, units };
}

export function projectProcessItem(item: Item): ProcessActivityProjection {
  if (item.type === "reasoning") return { kind: "summary-only", item };
  if (item.type === "text") return { kind: "standalone", item };
  if (item.type === "activity" && item.activity === "context-compression") {
    return { kind: "standalone", item };
  }
  if (item.type === "tool" && isStandaloneLifecycleTool(item)) {
    return { kind: "standalone", item };
  }
  if (
    item.type === "plan"
    || item.type === "execution-plan"
    || item.type === "question"
    || item.type === "patch"
  ) {
    return { kind: "standalone", item };
  }
  return { kind: "groupable", item };
}

export function CanonicalTurnActivity({
  canCollapse,
  children,
  expanded,
  onExpandedChange,
  summary,
}: {
  canCollapse: boolean;
  children?: React.ReactNode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  summary: TurnWorkSummary | null;
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion();
  const contentId = React.useId();
  const hasContent = children != null;
  const disclosureEnabled = canCollapse && hasContent && summary != null;
  const contentVisible = hasContent && (!disclosureEnabled || expanded);
  const content = hasContent ? (
    <motion.div
      animate={{ opacity: 1, transform: "translateY(0)" }}
      className="canonical-turn-activity__content"
      exit={{
        opacity: 0,
        pointerEvents: "none",
        transform: reducedMotion ? "translateY(0)" : "translateY(-8px)",
      }}
      id={contentId}
      initial={{
        opacity: 0,
        transform: reducedMotion ? "translateY(0)" : "translateY(-8px)",
      }}
      transition={motionTransition(reducedMotion, layoutTween)}
      key="turn-activity-content"
    >
      {children}
    </motion.div>
  ) : null;

  if (!summary) {
    return content;
  }

  const summaryContent = (
    <>
      <span>{summary.label}</span>
      {disclosureEnabled ? (
        <ChevronRight
          aria-hidden="true"
          className="canonical-turn-activity__chevron"
        />
      ) : null}
    </>
  );

  return (
    <section
      className="canonical-turn-activity"
      data-expandable={disclosureEnabled ? "true" : "false"}
      data-expanded={contentVisible ? "true" : "false"}
      data-state={summary.kind}
    >
      {disclosureEnabled ? (
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"}处理过程：${summary.label}`}
          className="canonical-turn-activity__summary"
          onClick={() => onExpandedChange(!expanded)}
          type="button"
        >
          {summaryContent}
        </button>
      ) : (
        <div className="canonical-turn-activity__summary">
          {summaryContent}
        </div>
      )}
      <div aria-hidden="true" className="canonical-turn-activity__divider" />
      <AnimatePresence initial={false} mode="popLayout">
        {contentVisible ? content : null}
      </AnimatePresence>
    </section>
  );
}

export function useTurnElapsedSeconds(
  turn: RenderTurnEntry["turn"],
  active: boolean,
): number {
  const [now, setNow] = React.useState(Date.now);

  React.useEffect(() => {
    setNow(Date.now());
    if (!active || turn.startedAt == null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active, turn.id, turn.startedAt]);

  return resolveTurnElapsedSeconds(turn, active, now);
}

export function resolveTurnElapsedSeconds(
  turn: RenderTurnEntry["turn"],
  active: boolean,
  now: number,
): number {
  if (turn.startedAt == null) return turn.elapsedSeconds;
  if (!active) {
    const terminalElapsed = turn.finishedAt == null
      ? 0
      : Math.floor(Math.max(0, turn.finishedAt - turn.startedAt) / 1_000);
    return Math.max(turn.elapsedSeconds, terminalElapsed);
  }
  return Math.max(turn.elapsedSeconds, Math.floor(
    Math.max(0, now - turn.startedAt) / 1_000,
  ));
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

  return React.useMemo(
    () => ({ expandedIds, onExpandedChange }),
    [expandedIds, onExpandedChange],
  );
}

function CanonicalThreadViewComponent({
  turns,
  threadId,
  active,
  loading,
  loadingOlder,
  hasOlder,
  error,
  initialScrollOffset,
  layoutResizeActive,
  listRef,
  navigationRef,
  scrollRef,
  onScroll,
  onCanReturnToBottomChange,
  onLoadOlder,
  onReload,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  registerTurnRow,
  rightDockPlanEventId,
  diffMarkerStyle = "color",
  readThreadPatchDiff,
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
  const renderTurn = React.useCallback(
    (entry: RenderTurnEntry): React.ReactElement => (
      <CanonicalTurnRow
        diffMarkerStyle={diffMarkerStyle}
        disclosureState={disclosureState}
        entry={entry}
        key={entry.id}
        onApplyPatch={onApplyPatch}
        onOpenPatchReview={onOpenPatchReview}
        onOpenPlanInRightDock={onOpenPlanInRightDock}
        onOpenSubagent={onOpenSubagent}
        registerTurnRow={registerTurnRow}
        rightDockPlanEventId={rightDockPlanEventId}
        readThreadPatchDiff={readThreadPatchDiff}
        threadId={threadId}
      />
    ),
    [
      disclosureState,
      diffMarkerStyle,
      onApplyPatch,
      onOpenPatchReview,
      onOpenPlanInRightDock,
      onOpenSubagent,
      registerTurnRow,
      rightDockPlanEventId,
      readThreadPatchDiff,
      threadId,
    ],
  );

  if (loading && turns.length === 0) {
    return (
      <FullScreenWhaleLoading
        label="正在加载会话内容…"
        variant="contained"
      />
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
    <div
      className="canonical-thread-view"
      data-canonical-thread-id={threadId}
      data-canonical-turn-count={turns.length}
    >
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
        layoutResizeActive={layoutResizeActive}
        items={turns}
        listRef={listRef}
        navigationRef={navigationRef}
        onCanReturnToBottomChange={onCanReturnToBottomChange}
        onScroll={onScroll}
        scrollRef={scrollRef}
        scrollToBottom={active}
        sessionKey={threadId}
        renderItem={renderTurn}
      />
    </div>
  );
}

export const CanonicalThreadView = React.memo(CanonicalThreadViewComponent);

const CanonicalTurnRow = React.memo(function CanonicalTurnRow({
  disclosureState,
  diffMarkerStyle,
  entry,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  registerTurnRow,
  rightDockPlanEventId,
  readThreadPatchDiff,
  threadId,
}: {
  disclosureState: {
    expandedIds: ReadonlySet<string>;
    onExpandedChange: (id: string, expanded: boolean) => void;
  };
  entry: RenderTurnEntry;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  onApplyPatch?: CanonicalThreadViewProps["onApplyPatch"];
  onOpenPatchReview?: CanonicalThreadViewProps["onOpenPatchReview"];
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  registerTurnRow?: RegisterConversationTurnRow;
  rightDockPlanEventId: string | null;
  readThreadPatchDiff?: ReadThreadPatchDiff;
  threadId: string;
}): React.ReactNode {
  const rowRef = React.useCallback(
    (node: HTMLDivElement | null): void => {
      registerTurnRow?.(entry.id, node);
    },
    [entry.id, registerTurnRow],
  );

  return (
    <div
      ref={rowRef}
      className="session-turn-row canonical-turn-row tw:mx-auto tw:w-full tw:min-w-0"
      data-component="conversation-turn"
      data-turn-navigation-id={entry.id}
    >
      <ConversationTurnErrorBoundary turnId={entry.id}>
        <CanonicalConversationTurn
          disclosureState={disclosureState}
          diffMarkerStyle={diffMarkerStyle}
          entry={entry}
          onApplyPatch={onApplyPatch}
          onOpenPatchReview={onOpenPatchReview}
          onOpenPlanInRightDock={onOpenPlanInRightDock}
          onOpenSubagent={onOpenSubagent}
          rightDockPlanEventId={rightDockPlanEventId}
          readThreadPatchDiff={readThreadPatchDiff}
          threadId={threadId}
        />
      </ConversationTurnErrorBoundary>
    </div>
  );
});

function CanonicalConversationTurnComponent({
  disclosureState,
  diffMarkerStyle = "color",
  entry,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
  readThreadPatchDiff,
  threadId,
}: {
  disclosureState: {
    expandedIds: ReadonlySet<string>;
    onExpandedChange: (id: string, expanded: boolean) => void;
  };
  entry: RenderTurnEntry;
  diffMarkerStyle?: DesktopDiffMarkerStyle;
  onApplyPatch?: CanonicalThreadViewProps["onApplyPatch"];
  onOpenPatchReview?: CanonicalThreadViewProps["onOpenPatchReview"];
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void;
  onOpenSubagent: (taskId: string) => void;
  rightDockPlanEventId: string | null;
  readThreadPatchDiff?: ReadThreadPatchDiff;
  threadId?: string;
}): React.ReactNode {
  const disclosure = (id: string) => ({
    id,
    expanded: disclosureState.expandedIds.has(id),
    onExpandedChange: disclosureState.onExpandedChange,
  });
  const reducedMotion = usePrefersReducedMotion();
  const processRowTransition = motionTransition(reducedMotion, layoutTween);
  const renderItem = (
    item: RenderTurnEntry["items"][number],
    options: {
      disclosureId?: string;
      presentation?: CanonicalItemRendererProps["presentation"];
      showAssistantActions?: boolean;
    } = {},
  ) => (
    <CanonicalItemRenderer
      disclosure={options.disclosureId ? disclosure(options.disclosureId) : undefined}
      item={item}
      key={item.id}
      onApplyPatch={onApplyPatch}
      onOpenPatchReview={onOpenPatchReview}
      onOpenPlanInRightDock={onOpenPlanInRightDock}
      onOpenSubagent={onOpenSubagent}
      presentation={options.presentation}
      rightDockPlanEventId={rightDockPlanEventId}
      showAssistantActions={options.showAssistantActions}
      threadId={threadId}
    />
  );
  const renderProcessItem = (
    item: RenderTurnEntry["processItems"][number],
    presentation: NonNullable<CanonicalItemRendererProps["presentation"]>,
  ): React.ReactNode => {
    if (item.type === "tool" && isFileMutationTool(item)) {
      return (
        <FileMutationItemView
          diffMarkerStyle={diffMarkerStyle}
          disclosureState={disclosureState}
          item={item}
          key={item.id}
          readThreadPatchDiff={readThreadPatchDiff}
          threadId={threadId}
        />
      );
    }
    if (item.type === "tool" && isStandaloneLifecycleTool(item)) {
      return <LifecycleToolItemView item={item} key={item.id} />;
    }
    return renderItem(item, { presentation });
  };
  const active = isActiveTurn(entry.turn.status);
  const hasAssistantResult = entry.assistantResultItems.length > 0;
  const activitySliceClosed = hasAssistantResult;
  const processActivity = buildProcessActivityModel(entry.processItems, {
    activitySliceClosed,
    hasBlockingRequest: entry.blockers.length > 0,
    turnActive: active,
  });
  const hasVisibleActivityContent = processActivity.units.length > 0
    || processActivity.showThinkingFallback;
  const elapsedSeconds = useTurnElapsedSeconds(entry.turn, active);
  const turnWorkSummary = entry.turn.startedAt != null
    || entry.processItems.length > 0
    || hasAssistantResult
    ? summarizeTurnWork(entry.turn.status, elapsedSeconds)
    : null;
  const turnActivityDisclosureId = `turn-activity:${entry.turn.id}`;
  const canCollapseTurnActivity = activitySliceClosed && hasVisibleActivityContent;
  const turnActivityExpanded = !canCollapseTurnActivity
    || disclosureState.expandedIds.has(turnActivityDisclosureId);
  const syntheticPatch = !active && entry.patchItems.length === 0
    ? syntheticPatchDisplay(entry.processItems)
    : null;
  const activityContent = hasVisibleActivityContent ? (
    <section className="canonical-turn__process" aria-label="处理过程">
      {processActivity.units.map((unit) => {
        if (unit.kind === "activity") {
          return (
            <React.Fragment key={unit.key}>
              {renderProcessItem(unit.item, "grouped")}
            </React.Fragment>
          );
        }
        if (unit.kind === "standalone") {
          return (
            <React.Fragment key={unit.key}>
              {renderProcessItem(unit.item, "standalone")}
            </React.Fragment>
          );
        }
        const summary = summarizeTurnProcessItems(
          unit.items,
          unit.key === processActivity.activeGroupKey
            ? entry.turn.status
            : "completed",
        );
        return (
          <CanonicalProcessGroup {...summary} key={unit.key}>
            {unit.items.map((item) => renderProcessItem(item, "grouped"))}
          </CanonicalProcessGroup>
        );
      })}
      {processActivity.showThinkingFallback ? (
        <div className="canonical-turn__thinking" role="status" aria-live="polite">
          <LoaderCircle className="canonical-spin" aria-hidden="true" />
          <span>正在思考</span>
        </div>
      ) : null}
    </section>
  ) : null;

  return (
    <article className="canonical-turn" data-status={entry.turn.status}>
      {entry.userItems.length ? (
        <section className="canonical-turn__user" aria-label="用户消息">
          {entry.userItems.map((input) => (
            <CanonicalUserInput
              attachments={entry.attachments.filter((attachment) => input.attachmentIds?.includes(attachment.id))}
              contextReferences={entry.contextReferences.filter(reference =>
                input.contextReferenceIds?.includes(reference.id),
              )}
              input={input}
              key={input.id}
            />
          ))}
        </section>
      ) : null}
      <CanonicalTurnActivity
        canCollapse={canCollapseTurnActivity}
        expanded={turnActivityExpanded}
        onExpandedChange={(expanded) => {
          disclosureState.onExpandedChange(turnActivityDisclosureId, expanded);
        }}
        summary={turnWorkSummary}
      >
        {activityContent}
      </CanonicalTurnActivity>
      {entry.blockers.length ? (
        <motion.section
          className="canonical-turn__blockers"
          aria-label="等待处理"
          layout="position"
          transition={processRowTransition}
        >
          {entry.blockers.map((blocker) => (
            <CanonicalBlocker
              blocker={blocker}
              key={blocker.id}
              renderItem={renderItem}
            />
          ))}
        </motion.section>
      ) : null}
      {entry.planItem ? (
        <motion.section
          className="canonical-turn__plan"
          layout="position"
          transition={processRowTransition}
        >
          {renderItem(entry.planItem)}
        </motion.section>
      ) : null}
      {entry.assistantResultItems.length > 0 ? (
        <motion.section
          className="canonical-turn__result"
          aria-label="助手回复"
          layout="position"
          transition={processRowTransition}
        >
          {entry.assistantResultItems.map((item) => renderItem(item, {
            showAssistantActions: true,
          }))}
        </motion.section>
      ) : null}
      {!active && entry.patchItems.length > 0 ? (
        <motion.section
          className="canonical-turn__post"
          aria-label="文件更改"
          layout="position"
          transition={processRowTransition}
        >
          {entry.patchItems.map((item) => renderItem(item))}
        </motion.section>
      ) : null}
      {syntheticPatch ? (
        <motion.section
          className="canonical-turn__post"
          aria-label="文件更改"
          layout="position"
          transition={processRowTransition}
        >
          <PatchSummaryView
            onOpenReview={onOpenPatchReview}
            patch={syntheticPatch}
          />
        </motion.section>
      ) : null}
      {entry.postAssistantItems.length > 0 ? (
        <motion.section
          className="canonical-turn__post"
          layout="position"
          transition={processRowTransition}
        >
          {entry.postAssistantItems.map((item) => renderItem(item))}
        </motion.section>
      ) : null}
      {entry.turn.error ? (
        <motion.div
          className="canonical-turn__status canonical-turn__status--error"
          layout="position"
          transition={processRowTransition}
        >
          <CircleAlert aria-hidden="true" />
          <span>{entry.turn.error}</span>
        </motion.div>
      ) : null}
    </article>
  );
}

export const CanonicalConversationTurn = React.memo(
  CanonicalConversationTurnComponent,
);

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
