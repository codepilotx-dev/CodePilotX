import type {
  EventEnvelope,
  Input,
  Part,
  Run,
  SessionEvent,
  SessionSnapshot,
} from "@codepilotx/shared/legacy"

export * from "./canonical"
export * from "./thread"

export type TimelinePartStatus = "streaming" | "completed" | "interrupted"
export type TimelineRunStatus = Run["status"]

export interface SessionViewOptions {
  now?: number
}

export interface TimelineView {
  rows: TimelineRow[]
  activeRunID: string | null
  queuedInputIDs: string[]
}

export interface UserMessageRow {
  kind: "user-message"
  id: string
  inputID: string
  runID: string | null
  content: string
  state: Input["state"]
  mode: Input["mode"]
  strategy: Input["strategy"]
  createdAt: number
  mergedIntoRunID: string | null
}

export interface AssistantTextRow {
  kind: "assistant-text"
  id: string
  partID: string
  runID: string
  placement: "process" | "result"
  text: string
  status: TimelinePartStatus
  createdAt: number
}

export interface ReasoningRow {
  kind: "reasoning"
  id: string
  partID: string
  runID: string
  text: string
  status: TimelinePartStatus
  defaultExpanded: boolean
  createdAt: number
}

export interface ToolRow {
  kind: "tool"
  id: string
  partID: string
  runID: string
  callID: string
  tool: string
  title: string
  state: Extract<Part, { type: "tool" }>["state"]
  input: unknown
  command: string | null
  output: string | null
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  createdAt: number
}

export interface ActivityCommandRow {
  command: string
  output: string
  status?: "success" | "running" | "error" | "interrupted"
  truncated?: boolean
}

export interface ActivityRow {
  kind: "activity"
  id: string
  partID: string
  runID: string
  activity: Extract<Part, { type: "activity" }>["activity"]
  title: string
  detail: string
  commands: ActivityCommandRow[]
  status: Extract<Part, { type: "activity" }>["status"]
  createdAt: number
}

export type ToolGroupItem = ToolRow | ActivityRow

export interface ToolGroupRow {
  kind: "tool-group"
  id: string
  runID: string
  items: ToolGroupItem[]
  defaultExpanded: boolean
  createdAt: number
  finishedAt: number
}

export interface PlanRow {
  kind: "plan"
  id: string
  partID: string
  runID: string
  title: string
  markdown: string
  version: number
  state: Extract<Part, { type: "plan" }>["state"]
  createdAt: number
}

export interface QuestionChoiceRow {
  id: string
  label: string
  description?: string
  recommended: boolean
}

export interface QuestionRow {
  kind: "question"
  id: string
  partID: string
  runID: string
  prompt: string
  choices: QuestionChoiceRow[]
  status: Extract<Part, { type: "question" }>["status"]
  answer: string | null
  createdAt: number
}

export interface PatchFileRow {
  path: string
  additions: number
  deletions: number
  patch?: string
}

export interface PatchRow {
  kind: "patch"
  id: string
  partID: string
  runID: string
  files: PatchFileRow[]
  totalAdditions: number
  totalDeletions: number
  createdAt: number
}

export interface RunStatusRow {
  kind: "run-status"
  id: string
  runID: string
  status: TimelineRunStatus
  mode: Run["mode"]
  currentStage: Run["currentStage"]
  error: string | null
  elapsedSeconds: number
  terminal: boolean
  createdAt: number
}

export interface QueueNoticeRow {
  kind: "queue-notice"
  id: string
  inputIDs: string[]
  createdAt: number
}

export type TimelineRow =
  | UserMessageRow
  | AssistantTextRow
  | ReasoningRow
  | ToolGroupRow
  | PlanRow
  | QuestionRow
  | PatchRow
  | RunStatusRow
  | QueueNoticeRow

export function applySessionEvent(snapshot: SessionSnapshot, envelope: EventEnvelope): SessionSnapshot {
  const event = envelope.event
  switch (event.type) {
    case "session.snapshot":
      return event.snapshot
    case "run.updated":
      return { ...snapshot, runs: upsert(snapshot.runs, event.run) }
    case "input.updated":
      return { ...snapshot, inputs: upsert(snapshot.inputs, event.input) }
    case "message.upserted":
      return { ...snapshot, messages: upsert(snapshot.messages, event.message) }
    case "part.upserted":
      return { ...snapshot, parts: upsert(snapshot.parts, event.part) }
    case "permission.updated":
      return { ...snapshot, permissions: upsert(snapshot.permissions, event.permission) }
    case "question.updated":
      return { ...snapshot, parts: upsert(snapshot.parts, event.question) }
    case "workflow.stages-updated":
      return updateRunStages(snapshot, event)
    case "queue.updated":
    case "heartbeat":
      return snapshot
  }
}

export function createSessionView(snapshot: SessionSnapshot, options: SessionViewOptions = {}): TimelineView {
  const now = options.now ?? Date.now()
  const inputs = [...snapshot.inputs].sort(compareByTime)
  const runs = [...snapshot.runs].sort(compareRuns)
  const runBySourceInput = new Map(snapshot.runs.map((run) => [run.sourceInputID, run]))
  const runByInput = new Map(snapshot.inputs.flatMap((input) => input.runID ? [[input.id, input.runID] as const] : []))
  const rows: TimelineRow[] = []
  const renderedRuns = new Set<string>()

  for (const input of inputs) {
    const sourceRun = runBySourceInput.get(input.id)
    const mergedIntoRunID = input.state === "merged" ? findMergedRunID(input, sourceRun, runByInput, snapshot.runs) : null
    rows.push(inputRow(input, mergedIntoRunID))
    if (sourceRun && !renderedRuns.has(sourceRun.id)) {
      rows.push(...runRows(sourceRun, snapshot.parts, now))
      renderedRuns.add(sourceRun.id)
    }
  }

  for (const run of runs) {
    if (renderedRuns.has(run.id)) continue
    rows.push(...runRows(run, snapshot.parts, now))
    renderedRuns.add(run.id)
  }

  const queuedInputIDs = inputs.filter((input) => input.state === "queued").map((input) => input.id)
  if (queuedInputIDs.length > 0) {
    rows.push({ kind: "queue-notice", id: `queue:${snapshot.session.id}`, inputIDs: queuedInputIDs, createdAt: now })
  }

  const activeRun = [...runs].reverse().find((run) => isActiveRun(run.status))
  return { rows, activeRunID: activeRun?.id ?? null, queuedInputIDs }
}

export function createTimelineRows(snapshot: SessionSnapshot, options: SessionViewOptions = {}): TimelineRow[] {
  return createSessionView(snapshot, options).rows
}

function runRows(run: Run, allParts: readonly Part[], now: number): TimelineRow[] {
  const parts = allParts.filter((part) => part.runID === run.id).sort(compareByTime)
  const rows: TimelineRow[] = []
  let toolItems: ToolGroupItem[] = []
  let statusInserted = false
  const statusRow: RunStatusRow = {
    kind: "run-status",
    id: `run-status:${run.id}`,
    runID: run.id,
    status: run.status,
    mode: run.mode,
    currentStage: run.currentStage,
    error: run.error,
    elapsedSeconds: elapsedSeconds(run, now),
    terminal: isTerminalRun(run.status),
    createdAt: run.finishedAt ?? run.startedAt ?? now,
  }

  const flushTools = () => {
    if (toolItems.length === 0) return
    const first = toolItems[0]
    const last = toolItems[toolItems.length - 1]
    rows.push({
      kind: "tool-group",
      id: `tool-group:${run.id}:${first.partID}`,
      runID: run.id,
      items: toolItems,
      defaultExpanded: false,
      createdAt: first.createdAt,
      finishedAt: last.createdAt,
    })
    toolItems = []
  }

  for (const part of parts) {
    if (part.type === "text" && part.placement === "result" && !statusInserted) {
      flushTools()
      rows.push(statusRow)
      statusInserted = true
    }
    if (part.type === "tool") {
      toolItems.push(toolRow(part))
      continue
    }
    if (part.type === "activity") {
      const row = activityRow(part)
      if (isNarrativeActivity(row)) {
        flushTools()
        rows.push(activityTextRow(row))
        continue
      }
      toolItems.push(row)
      continue
    }
    flushTools()
    const row = partRow(part)
    if (row) rows.push(row)
  }
  flushTools()
  if (!statusInserted) rows.push(statusRow)
  return rows
}

function partRow(part: Part): TimelineRow | null {
  if (part.type === "text") {
    return {
      kind: "assistant-text",
      id: `text:${part.id}`,
      partID: part.id,
      runID: part.runID,
      placement: part.placement,
      text: part.text,
      status: part.status,
      createdAt: part.createdAt,
    }
  }
  if (part.type === "reasoning") {
    return {
      kind: "reasoning",
      id: `reasoning:${part.id}`,
      partID: part.id,
      runID: part.runID,
      text: part.text,
      status: part.status,
      defaultExpanded: !isTerminalPart(part.status),
      createdAt: part.createdAt,
    }
  }
  if (part.type === "plan") {
    return {
      kind: "plan",
      id: `plan:${part.id}`,
      partID: part.id,
      runID: part.runID,
      title: part.title,
      markdown: part.markdown,
      version: part.version,
      state: part.state,
      createdAt: part.createdAt,
    }
  }
  if (part.type === "question") {
    return {
      kind: "question",
      id: `question:${part.id}`,
      partID: part.id,
      runID: part.runID,
      prompt: part.prompt,
      choices: part.choices.map((choice) => ({ ...choice })),
      status: part.status,
      answer: part.answer,
      createdAt: part.createdAt,
    }
  }
  if (part.type === "patch") {
    return {
      kind: "patch",
      id: `patch:${part.id}`,
      partID: part.id,
      runID: part.runID,
      files: part.files.map((file) => ({ ...file })),
      totalAdditions: part.totalAdditions,
      totalDeletions: part.totalDeletions,
      createdAt: part.createdAt,
    }
  }
  return null
}

function inputRow(input: Input, mergedIntoRunID: string | null): UserMessageRow {
  return {
    kind: "user-message",
    id: `input:${input.id}`,
    inputID: input.id,
    runID: input.runID,
    content: input.content,
    state: input.state,
    mode: input.mode,
    strategy: input.strategy,
    createdAt: input.createdAt,
    mergedIntoRunID,
  }
}

function toolRow(part: Extract<Part, { type: "tool" }>): ToolRow {
  return {
    kind: "tool",
    id: `tool:${part.id}`,
    partID: part.id,
    runID: part.runID,
    callID: part.callID,
    tool: part.tool,
    title: part.title,
    state: part.state,
    input: part.input,
    command: part.command,
    output: part.output,
    error: part.error,
    startedAt: part.startedAt,
    finishedAt: part.finishedAt,
    durationMs: part.durationMs,
    createdAt: part.createdAt,
  }
}

function activityRow(part: Extract<Part, { type: "activity" }>): ActivityRow {
  return {
    kind: "activity",
    id: `activity:${part.id}`,
    partID: part.id,
    runID: part.runID,
    activity: part.activity,
    title: part.title,
    detail: part.detail ?? "",
    commands: part.commands?.map((command) => ({ ...command })) ?? [],
    status: part.status,
    createdAt: part.createdAt,
  }
}

function activityTextRow(row: ActivityRow): AssistantTextRow {
  return {
    kind: "assistant-text",
    id: `activity-text:${row.partID}`,
    partID: row.partID,
    runID: row.runID,
    placement: "process",
    text: row.detail,
    status: row.status === "running" ? "streaming" : row.status === "interrupted" || row.status === "error" ? "interrupted" : "completed",
    createdAt: row.createdAt,
  }
}

function isNarrativeActivity(row: ActivityRow): boolean {
  return row.activity === "notice" && row.commands.length === 0 && row.detail.trim().length > 0
}

function findMergedRunID(input: Input, sourceRun: Run | undefined, runByInput: Map<string, string>, runs: readonly Run[]): string | null {
  if (input.runID) return input.runID
  if (sourceRun) return sourceRun.id
  const direct = runByInput.get(input.id)
  if (direct) return direct
  return runs.find((run) => run.mergedInputIDs.includes(input.id))?.id ?? null
}

function updateRunStages(snapshot: SessionSnapshot, event: Extract<SessionEvent, { type: "workflow.stages-updated" }>): SessionSnapshot {
  const run = snapshot.runs.find((candidate) => candidate.id === event.runID)
  if (!run) return snapshot
  return { ...snapshot, runs: upsert(snapshot.runs, { ...run, stages: event.stages }) }
}

function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  if (index < 0) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

function compareByTime<T extends { id: string; createdAt: number }>(left: T, right: T): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

function compareRuns(left: Run, right: Run): number {
  return (left.startedAt ?? 0) - (right.startedAt ?? 0) || left.id.localeCompare(right.id)
}

function isActiveRun(status: Run["status"]): boolean {
  return status === "queued" || status === "running" || status === "waiting-permission" || status === "waiting-question" || status === "waiting-plan-confirmation"
}

function isTerminalRun(status: Run["status"]): boolean {
  return status === "completed" || status === "failed" || status === "stopped" || status === "interrupted"
}

function isTerminalPart(status: TimelinePartStatus): boolean {
  return status === "completed" || status === "interrupted"
}

function elapsedSeconds(run: Run, now: number): number {
  if (run.startedAt === null) return run.elapsedSeconds
  if (run.finishedAt !== null) return Math.max(run.elapsedSeconds, Math.floor((run.finishedAt - run.startedAt) / 1000))
  return Math.max(run.elapsedSeconds, Math.floor((now - run.startedAt) / 1000))
}
