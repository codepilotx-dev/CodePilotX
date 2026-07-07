/**
 * timelineAdapter.test.ts — Tests for the PhaseTimelineItem → TimelineRow adapter.
 */

import { beforeAll, expect, test } from 'bun:test';
import type {
  DesktopSessionEvent,
  DesktopSessionStatus,
} from '../../../shared/types.js';
import type { PhaseTimelineItem } from './ConversationPage.js';

// Types and functions we'll test
let convertPhaseItemsToRows: typeof import('./timelineAdapter.js').convertPhaseItemsToRows;
let findRowIndexForKey: typeof import('./timelineAdapter.js').findRowIndexForKey;
let findRowIndexForEventId: typeof import('./timelineAdapter.js').findRowIndexForEventId;
let buildEventIdToRowIndex: typeof import('./timelineAdapter.js').buildEventIdToRowIndex;

// Helpers to build the conversation pipeline (using the exported types from ConversationPage)
let groupTimelineToolEvents: (
  sourceEvents: DesktopSessionEvent[],
) => PhaseTimelineItem[];
let groupTimelineExecutionPhases: (
  items: PhaseTimelineItem[],
  sessionStatus: DesktopSessionStatus,
) => PhaseTimelineItem[];
let deriveAssistantActionMessageIds: (params: {
  sessionStatus: DesktopSessionStatus;
  timelineEvents: DesktopSessionEvent[];
}) => Set<string>;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { desktopApi: {} },
  });
  const [adapter, conversationPage] = await Promise.all([
    import('./timelineAdapter.js'),
    import('./ConversationPage.js'),
  ]);
  convertPhaseItemsToRows = adapter.convertPhaseItemsToRows;
  findRowIndexForKey = adapter.findRowIndexForKey;
  findRowIndexForEventId = adapter.findRowIndexForEventId;
  buildEventIdToRowIndex = adapter.buildEventIdToRowIndex;
  groupTimelineToolEvents =
    conversationPage.groupTimelineToolEvents as typeof groupTimelineToolEvents;
  groupTimelineExecutionPhases =
    conversationPage.groupTimelineExecutionPhases as typeof groupTimelineExecutionPhases;
  deriveAssistantActionMessageIds =
    conversationPage.deriveAssistantActionMessageIds as typeof deriveAssistantActionMessageIds;
});

/* ── Helper: build the full pipeline from raw events ───── */

function buildPhaseItems(
  events: DesktopSessionEvent[],
  sessionStatus: DesktopSessionStatus,
): PhaseTimelineItem[] {
  const folded = foldTimelineEvents(events);
  const toolGrouped = groupTimelineToolEvents(folded);
  return groupTimelineExecutionPhases(toolGrouped, sessionStatus);
}

/* ── Helper: identity fold (same as in ConversationPage) ─ */

function foldTimelineEvents(
  sourceEvents: DesktopSessionEvent[],
): DesktopSessionEvent[] {
  const folded: DesktopSessionEvent[] = [];
  for (const event of sourceEvents) {
    const previous = folded.at(-1);
    if (event.type === 'assistant_delta') {
      if (previous?.type === 'assistant_delta') {
        folded[folded.length - 1] = event;
      } else {
        folded.push(event);
      }
      continue;
    }
    if (
      event.type === 'message' &&
      event.role === 'assistant' &&
      previous?.type === 'assistant_delta'
    ) {
      folded[folded.length - 1] = event;
      continue;
    }
    folded.push(event);
  }
  return folded;
}

/* ── Helper: create a mock callbacks object ────────────── */

function mockCallbacks() {
  return {
    onOpenPlanInRightDock: () => {},
    onDiscardChanges: () => Promise.resolve(),
    onReviewCode: () => {},
    onReviewFiles: () => {},
    onSubmitEditedUserMessage: async () => {},
    sessionStatus: 'idle',
  };
}

/* ── Event builder helpers ─────────────────────────────── */

function userEvent(id: string, content: string): DesktopSessionEvent {
  return messageEvent(id, 'user', content);
}

function assistantEvent(id: string, content: string): DesktopSessionEvent {
  return messageEvent(id, 'assistant', content);
}

function messageEvent(
  id: string,
  role: 'user' | 'assistant',
  content: string,
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'message',
    role,
    content,
    createdAt: '2026-06-26T00:00:00.000Z',
  };
}

function checkpointEvent(id: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'checkpoint',
    content: 'done',
    createdAt: '2026-06-26T00:00:01.000Z',
    metadata: { status: 'done' },
  };
}

function proposedPlanEvent(id: string, content: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'proposed_plan',
    role: 'assistant',
    content,
    createdAt: '2026-06-26T00:00:00.500Z',
    metadata: {},
  };
}

function toolCallEvent(
  id: string,
  toolName: string,
  content: string,
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'tool_call',
    content,
    createdAt: '2026-06-26T00:00:00.000Z',
    metadata: { toolName, toolUseId: 'tool-use-1' },
  };
}

function toolResultEvent(
  id: string,
  toolName: string,
  content: string,
  isError: boolean,
  metadata: Record<string, unknown> = {},
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'tool_result',
    content,
    createdAt: '2026-06-26T00:00:01.000Z',
    metadata: { ...metadata, toolName, toolUseId: 'tool-use-1', isError },
  };
}

function filePatchEvent(id: string, filePath: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'file_patch',
    content: `Edited ${filePath}`,
    createdAt: '2026-06-26T00:00:01.000Z',
    metadata: {
      files: [{ path: filePath, additions: 5, deletions: 2 }],
      additions: 5,
      deletions: 2,
      turnScoped: true,
    },
  };
}

function errorEvent(id: string, content: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'error',
    role: 'system',
    content,
    createdAt: '2026-06-26T00:00:01.000Z',
  };
}

/* ══════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════ */

/* ── Row conversion ──────────────────────────────────── */

test('converts user and assistant messages into protocol rows', () => {
  const events = [
    userEvent('user-1', 'Hello'),
    assistantEvent('assistant-1', 'Hi there'),
    checkpointEvent('done-1'),
  ];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const assistantIds = new Set(['assistant-1']);
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, assistantIds, callbacks);

  // Check row types and order
  expect(rows.length).toBeGreaterThanOrEqual(3);
  expect(rows[0]!.type).toBe('user_message');
  expect(rows[1]!.type).toBe('assistant_message');
  // Last row should be bottom_spacer
  expect(rows[rows.length - 1]!.type).toBe('bottom_spacer');

  // Check payload
  if (rows[0]!.type === 'user_message') {
    expect(rows[0].message.text).toBe('Hello');
    expect(rows[0].eventId).toBe('user-1');
  }
  if (rows[1]!.type === 'assistant_message') {
    expect(rows[1].message.text).toBe('Hi there');
    expect(rows[1].showActions).toBe(true);
  }
});

test('converts tool groups into tool_group rows', () => {
  const events = [
    userEvent('user-1', 'Run tests'),
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    toolResultEvent('result-1', 'Bash', 'passed', false),
    checkpointEvent('done-1'),
  ];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, new Set(), callbacks);

  expect(rows.length).toBeGreaterThanOrEqual(3);
  expect(rows[0]!.type).toBe('user_message');
  expect(rows[1]!.type).toBe('tool_group');
  if (rows[1]!.type === 'tool_group') {
    // First run is the real tool, second is synthetic terminal from checkpoint
    expect(rows[1].group.runs.length).toBeGreaterThanOrEqual(1);
    expect(rows[1].group.runs[0]!.toolName).toBe('Bash');
  }
});

test('converts execution phases into execution_phase rows', () => {
  const events = [
    userEvent('user-1', 'Build feature'),
    proposedPlanEvent('plan-1', '# Plan to build'),
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    toolResultEvent('result-1', 'Bash', 'passed', false),
    checkpointEvent('done-1'),
  ];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, new Set(), callbacks);

  // Expect: user_message, plan, execution_phase, bottom_spacer
  expect(rows[0]!.type).toBe('user_message');
  expect(rows[1]!.type).toBe('plan');

  // The third item should be execution_phase (since there are execution items)
  expect(rows[2]!.type).toBe('execution_phase');
  if (rows[2]!.type === 'execution_phase') {
    expect(rows[2].phase.isComplete).toBe(true);
  }
});

test('converts file patches into diff_summary rows', () => {
  const events = [
    userEvent('user-1', 'Edit files'),
    filePatchEvent('file-1', '/src/index.ts'),
    checkpointEvent('done-1'),
  ];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, new Set(), callbacks);

  const diffRow = rows.find((r) => r.type === 'diff_summary');
  expect(diffRow).toBeDefined();
  if (diffRow?.type === 'diff_summary') {
    expect(diffRow.eventId).toBe('file-1');
  }
});

test('hides file_patch without turnScoped metadata', () => {
  const events = [
    userEvent('user-2', 'Old session'),
    {
      id: 'file-legacy',
      sessionId: 'session-1',
      type: 'file_patch' as const,
      content: 'Edited /src/old.ts',
      createdAt: '2026-06-26T00:00:01.000Z',
      metadata: {
        files: [{ path: '/src/old.ts', additions: 3, deletions: 1 }],
        additions: 3,
        deletions: 1,
        // no turnScoped
      },
    },
    checkpointEvent('done-2'),
  ];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, new Set(), callbacks);

  const diffRow = rows.find((r) => r.type === 'diff_summary');
  expect(diffRow).toBeUndefined();
});

test('converts errors into error rows', () => {
  const events = [
    userEvent('user-1', 'Do something'),
    errorEvent('err-1', 'Something went wrong'),
    checkpointEvent('done-1'),
  ];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, new Set(), callbacks);

  const errRow = rows.find((r) => r.type === 'error');
  expect(errRow).toBeDefined();
  if (errRow?.type === 'error') {
    expect(errRow.content).toBe('Something went wrong');
    expect(errRow.eventId).toBe('err-1');
  }
});

test('adds thinking row when session is running and no recent assistant message', () => {
  const events = [
    userEvent('user-1', 'Build feature'),
    // No assistant message yet — session is running
  ];
  const items = buildPhaseItems(events, 'running' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'running' as DesktopSessionStatus, new Set(), callbacks);

  const thinkingRow = rows.find((r) => r.type === 'thinking');
  expect(thinkingRow).toBeDefined();
});

test('does not add thinking row when session is idle', () => {
  const events = [
    userEvent('user-1', 'Build feature'),
    assistantEvent('assistant-1', 'Done'),
    checkpointEvent('done-1'),
  ];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, new Set(), callbacks);

  const thinkingRow = rows.find((r) => r.type === 'thinking');
  expect(thinkingRow).toBeUndefined();
});

test('always adds a bottom spacer at the end', () => {
  const events = [userEvent('user-1', 'Hello')];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, new Set(), callbacks);

  expect(rows[rows.length - 1]!.type).toBe('bottom_spacer');
});

/* ── Hash / navigation helpers ───────────────────────── */

test('findRowIndexForKey finds the correct index', () => {
  const rows = [
    { key: 'a', type: 'user_message' as const, message: { id: '1', role: 'user' as const, text: 'hi', createdAt: '' }, eventId: '1' },
    { key: 'b', type: 'assistant_message' as const, message: { id: '2', role: 'assistant' as const, text: 'hello', createdAt: '' }, showActions: false, eventId: '2' },
    { key: 'c', type: 'bottom_spacer' as const },
  ];

  expect(findRowIndexForKey(rows, 'b')).toBe(1);
  expect(findRowIndexForKey(rows, 'a')).toBe(0);
  expect(findRowIndexForKey(rows, 'nonexistent')).toBe(-1);
});

test('findRowIndexForEventId finds rows by event id', () => {
  const rows = [
    { key: 'u-1', type: 'user_message' as const, message: { id: '1', role: 'user' as const, text: 'hi', createdAt: '' }, eventId: 'evt-1' },
    { key: 'a-2', type: 'assistant_message' as const, message: { id: '2', role: 'assistant' as const, text: 'hello', createdAt: '' }, showActions: false, eventId: 'evt-2' },
    { key: 'bs-end', type: 'bottom_spacer' as const },
  ];

  expect(findRowIndexForEventId(rows, 'evt-1')).toBe(0);
  expect(findRowIndexForEventId(rows, 'evt-2')).toBe(1);
  expect(findRowIndexForEventId(rows, 'missing')).toBe(-1);
});

test('buildEventIdToRowIndex builds a correct map', () => {
  const rows = [
    { key: 'u-1', type: 'user_message' as const, message: { id: '1', role: 'user' as const, text: 'a', createdAt: '' }, eventId: 'a' },
    { key: 'a-2', type: 'assistant_message' as const, message: { id: '2', role: 'assistant' as const, text: 'b', createdAt: '' }, showActions: false, eventId: 'b' },
    { key: 'tg-3', type: 'tool_group' as const, group: { id: 'g3', type: 'tool_group' as const, runs: [] }, eventId: 'c' },
    { key: 'bs-end', type: 'bottom_spacer' as const },
  ];

  const map = buildEventIdToRowIndex(rows);
  expect(map.get('a')).toBe(0);
  expect(map.get('b')).toBe(1);
  expect(map.get('c')).toBe(2);
  expect(map.has('missing')).toBe(false);
});

/* ── Full conversation scenario ───────────────────────── */

test('produces correct row sequence for a complete conversation turn', () => {
  // Simulate a typical turn: user asks → assistant plans → tools run → file changes → final summary
  const events = [
    userEvent('user-1', 'Add a new feature'),
    proposedPlanEvent('plan-1', '# Feature Plan\n\nImplement X'),
    toolCallEvent('tool-1', 'Bash', 'npm run build'),
    toolResultEvent('result-1', 'Bash', 'Build successful', false),
    filePatchEvent('file-1', '/src/feature.ts'),
    assistantEvent('assistant-1', 'Feature complete. Here is the summary...'),
    checkpointEvent('done-1'),
  ];
  const items = buildPhaseItems(events, 'idle' as DesktopSessionStatus);
  const assistantIds = deriveAssistantActionMessageIds({
    sessionStatus: 'idle' as DesktopSessionStatus,
    timelineEvents: events,
  });
  const callbacks = mockCallbacks();
  const rows = convertPhaseItemsToRows(items, 'idle' as DesktopSessionStatus, assistantIds, callbacks);

  // Expected rows: user_message, plan, execution_phase, diff_summary, assistant_message, bottom_spacer
  const nonSpacerRows = rows.filter((r) => r.type !== 'bottom_spacer');
  expect(nonSpacerRows).toHaveLength(5);

  expect(nonSpacerRows[0]!.type).toBe('user_message');
  expect(nonSpacerRows[1]!.type).toBe('plan');
  expect(nonSpacerRows[2]!.type).toBe('execution_phase');
  expect(nonSpacerRows[3]!.type).toBe('diff_summary');
  expect(nonSpacerRows[4]!.type).toBe('assistant_message');

  // Final assistant should have action buttons
  if (nonSpacerRows[4]!.type === 'assistant_message') {
    expect(nonSpacerRows[4].showActions).toBe(true);
    expect(nonSpacerRows[4].message.text).toBe('Feature complete. Here is the summary...');
  }
});
