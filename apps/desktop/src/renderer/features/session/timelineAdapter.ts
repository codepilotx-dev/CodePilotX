/**
 * timelineAdapter.ts — Convert existing PhaseTimelineItem[] + state
 * into TimelineRow[] for virtual rendering.
 *
 * This adapter sits between the data pipeline
 *   (deriveTimelineSourceEvents → foldTimelineEvents →
 *    groupTimelineToolEvents → groupTimelineExecutionPhases)
 * and the new SessionTimelineView.
 *
 * It preserves all existing event-grouping logic (tool pairing,
 * execution phases, action-message derivation) and simply
 * translates the group-phase output into protocol rows.
 */

import type { DesktopSessionEvent, DesktopSessionStatus } from '../../../shared/types.js';
import type { Message } from '../../uiTypes.js';
import {
  ROW_PREFIX,
  rowKey,
  type TimelineRow,
  type TimelineRowCallbacks,
} from './timelineProtocol.js';
import type { PhaseTimelineItem, TimelineItem } from './ConversationPage.js';

/* ── Internal helpers ───────────────────────────────────── */

function eventId(event: DesktopSessionEvent): string {
  return event.id;
}

function messageFromEvent(event: DesktopSessionEvent): Message {
  return {
    id: event.id,
    role: event.role ?? 'system',
    text: event.content ?? '',
    createdAt: event.createdAt,
    streaming: event.type === 'assistant_delta',
  };
}

function planSummary(event: DesktopSessionEvent): string {
  return event.content?.trim() ?? '';
}

function isAssistantMessage(item: TimelineItem): boolean {
  return (
    (item.type === 'message' || item.type === 'assistant_delta') &&
    item.role === 'assistant'
  );
}

function isUserMessage(item: TimelineItem): boolean {
  return item.type === 'message' && item.role === 'user';
}

function isSystemMessage(item: TimelineItem): boolean {
  return item.type === 'message' && item.role === 'system';
}

function isPlan(item: TimelineItem): boolean {
  return item.type === 'proposed_plan';
}

function isDiff(item: TimelineItem): boolean {
  return (
    item.type === 'file_patch' &&
    (item as DesktopSessionEvent).metadata?.turnScoped === true
  );
}

function isError(item: TimelineItem): boolean {
  return item.type === 'error';
}

function isPermission(item: TimelineItem): boolean {
  return item.type === 'permission_request';
}

/* ── Main adapter ───────────────────────────────────────── */

/**
 * Convert a PhaseTimelineItem[] (the current grouped output) into
 * TimelineRow[] for the virtual timeline.
 *
 * @param items      — grouped timeline items (phaseItems)
 * @param sessionStatus — current session status
 * @param assistantActionMessageIds — set of assistant message ids that get action buttons
 * @param callbacks  — narrow callback bundle for interactive rows
 */
export function convertPhaseItemsToRows(
  items: PhaseTimelineItem[],
  sessionStatus: DesktopSessionStatus,
  assistantActionMessageIds: ReadonlySet<string>,
  callbacks: TimelineRowCallbacks,
): TimelineRow[] {
  const rows: TimelineRow[] = [];

  for (const item of items) {
    if (item.type === 'execution_phase') {
      const phaseEvent = item.items.find(
        (child): child is DesktopSessionEvent =>
          'type' in child && isPlan(child),
      );
      rows.push({
        key: rowKey(ROW_PREFIX.EXECUTION_PHASE, item.id),
        type: 'execution_phase',
        phase: item,
        eventId: phaseEvent?.id ?? item.id,
      });
      continue;
    }

    if (item.type === 'tool_group') {
      rows.push({
        key: rowKey(ROW_PREFIX.TOOL_GROUP, item.id),
        type: 'tool_group',
        group: item,
        eventId: item.id,
      });
      continue;
    }

    const event = item as DesktopSessionEvent;

    if (isUserMessage(event)) {
      rows.push({
        key: rowKey(ROW_PREFIX.USER, eventId(event)),
        type: 'user_message',
        message: messageFromEvent(event),
        eventId: eventId(event),
      });
      continue;
    }

    if (isAssistantMessage(event)) {
      rows.push({
        key: rowKey(ROW_PREFIX.ASSISTANT, eventId(event)),
        type: 'assistant_message',
        message: messageFromEvent(event),
        showActions: assistantActionMessageIds.has(eventId(event)),
        eventId: eventId(event),
      });
      continue;
    }

    if (isSystemMessage(event)) {
      rows.push({
        key: rowKey(ROW_PREFIX.SYSTEM, eventId(event)),
        type: 'system_event',
        content: event.content ?? '',
        systemEventType: 'message',
        eventId: eventId(event),
      });
      continue;
    }

    if (isPlan(event)) {
      const summary = planSummary(event);
      if (!summary) continue;
      rows.push({
        key: rowKey(ROW_PREFIX.PLAN, eventId(event)),
        type: 'plan',
        event,
        summary,
        streaming: event.metadata?.streaming === true,
        rightDockPlanOpen: false,
        rightDockPlanContent: null,
        eventId: eventId(event),
      });
      continue;
    }

    if (isDiff(event)) {
      rows.push({
        key: rowKey(ROW_PREFIX.DIFF, eventId(event)),
        type: 'diff_summary',
        event,
        eventId: eventId(event),
      });
      continue;
    }

    if (isPermission(event)) {
      rows.push({
        key: rowKey(ROW_PREFIX.SYSTEM, eventId(event)),
        type: 'system_event',
        content: event.content ?? '',
        systemEventType: 'permission_request',
        eventId: eventId(event),
      });
      continue;
    }

    if (isError(event)) {
      rows.push({
        key: rowKey(ROW_PREFIX.ERROR, eventId(event)),
        type: 'error',
        content: event.content ?? '',
        eventId: eventId(event),
      });
      continue;
    }

    // skip checkpoints, status events — they are hidden
  }

  // Add thinking row at the end if the session is active and no recent assistant message
  const hasRecentAssistant = rows
    .slice(-3)
    .some((r) => r.type === 'assistant_message');
  const showThinking =
    (sessionStatus === 'running' || sessionStatus === 'waiting') &&
    !hasRecentAssistant;
  if (showThinking) {
    rows.push({
      key: rowKey(ROW_PREFIX.THINKING, 'latest'),
      type: 'thinking',
    });
  }

  // Add bottom spacer for scroll padding
  rows.push({
    key: rowKey(ROW_PREFIX.BOTTOM_SPACER, 'end'),
    type: 'bottom_spacer',
  });

  return rows;
}

/* ── Hash / message-location helpers ────────────────────── */

/**
 * Find the row index for a given event or message id.
 * Used for hash-anchor navigation and "scroll to message".
 */
export function findRowIndexForKey(
  rows: TimelineRow[],
  targetKey: string,
): number {
  return rows.findIndex((r) => r.key === targetKey);
}

/**
 * Find the row index for a given event id by scanning relevant row types.
 */
export function findRowIndexForEventId(
  rows: TimelineRow[],
  eventId: string,
): number {
  return rows.findIndex((r) => {
    if ('eventId' in r && r.eventId === eventId) return true;
    return false;
  });
}

/**
 * Extract event ids from rows for hash-nav lookup.
 */
export function buildEventIdToRowIndex(
  rows: TimelineRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if ('eventId' in r && r.eventId) {
      map.set(r.eventId, i);
    }
  }
  return map;
}
