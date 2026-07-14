/**
 * timelineProtocol.ts — Protocol types for the session timeline.
 *
 * These types define the intermediate "row" layer between the raw
 * DesktopSessionEvent / PhaseTimelineItem pipeline and the virtual-scrolling
 * React view. Every row has a stable `key` (used for virtua key and hash
 * navigation), a `type` discriminator, and type-specific payload.
 *
 * The row types mirror opencode's turn/part structure but stay read-only
 * compatible with existing Codex Desktop workflows.
 */

import type { DesktopSessionEvent } from '../../../shared/types.js';
import type { Message } from '../../uiTypes.js';
import type {
  TimelineToolGroup,
  ExecutionPhaseGroup,
} from './ConversationPage.js';

/* ── Row key helpers ────────────────────────────────────── */

/** Row key format: `<prefix>-<id>` where prefix is one of these constants. */
export const ROW_PREFIX = {
  USER: 'u',
  ASSISTANT: 'a',
  TOOL_GROUP: 'tg',
  PLAN: 'p',
  DIFF: 'd',
  THINKING: 't',
  ERROR: 'e',
  SYSTEM: 's',
  TURN_DIVIDER: 'td',
  BOTTOM_SPACER: 'bs',
  EXECUTION_PHASE: 'ep',
} as const;

export type TimelineRowKey = string;

/** Build a stable row key. */
export function rowKey(prefix: string, id: string): TimelineRowKey {
  return `${prefix}-${id}`;
}

/* ── Row types ──────────────────────────────────────────── */

export type TimelineUserMessageRow = {
  key: TimelineRowKey;
  type: 'user_message';
  message: Message;
  eventId: string;
};

export type TimelineAssistantMessageRow = {
  key: TimelineRowKey;
  type: 'assistant_message';
  message: Message;
  showActions: boolean;
  eventId: string;
};

export type TimelineToolGroupRow = {
  key: TimelineRowKey;
  type: 'tool_group';
  group: TimelineToolGroup;
  eventId: string;
};

export type TimelineExecutionPhaseRow = {
  key: TimelineRowKey;
  type: 'execution_phase';
  phase: ExecutionPhaseGroup;
  eventId: string;
};

export type TimelinePlanRow = {
  key: TimelineRowKey;
  type: 'plan';
  event: DesktopSessionEvent;
  summary: string;
  streaming: boolean;
  rightDockPlanOpen: boolean;
  rightDockPlanContent: string | null;
  eventId: string;
};

export type TimelineDiffSummaryRow = {
  key: TimelineRowKey;
  type: 'diff_summary';
  event: DesktopSessionEvent;
  eventId: string;
};

export type TimelineThinkingRow = {
  key: TimelineRowKey;
  type: 'thinking';
};

export type TimelineErrorRow = {
  key: TimelineRowKey;
  type: 'error';
  content: string;
  eventId: string;
};

export type TimelineSystemEventRow = {
  key: TimelineRowKey;
  type: 'system_event';
  content: string;
  systemEventType: string;
  eventId: string;
};

export type TimelineTurnDividerRow = {
  key: TimelineRowKey;
  type: 'turn_divider';
  label: string;
};

export type TimelineBottomSpacerRow = {
  key: TimelineRowKey;
  type: 'bottom_spacer';
};

/** Union of all protocol row types. */
export type TimelineRow =
  | TimelineUserMessageRow
  | TimelineAssistantMessageRow
  | TimelineToolGroupRow
  | TimelineExecutionPhaseRow
  | TimelinePlanRow
  | TimelineDiffSummaryRow
  | TimelineThinkingRow
  | TimelineErrorRow
  | TimelineSystemEventRow
  | TimelineTurnDividerRow
  | TimelineBottomSpacerRow;

/* ── Callback bundle passed to row renderers ────────────── */

/**
 * Ops that row renderers can invoke.  Kept narrow — only what
 * interactive rows actually need, so the adapter layer stays
 * decoupled from the full QuickChatContext.
 */
export type TimelineRowCallbacks = {
  onOpenPlanInRightDock: (plan: { title: string; content: string }) => void;
  onDiscardChanges: (paths: string[], turnRestoreId?: string | null) => void;
  onReviewCode: () => void;
  onReviewFiles: () => void;
  onSubmitEditedUserMessage: (text: string) => Promise<void>;
  sessionStatus: DesktopSessionEvent['type'] extends string ? string : string;
};

/* ── Utility ────────────────────────────────────────────── */

export function isMessageRow(
  row: TimelineRow,
): row is TimelineUserMessageRow | TimelineAssistantMessageRow {
  return row.type === 'user_message' || row.type === 'assistant_message';
}

export function isToolOrPhaseRow(
  row: TimelineRow,
): row is TimelineToolGroupRow | TimelineExecutionPhaseRow {
  return row.type === 'tool_group' || row.type === 'execution_phase';
}
