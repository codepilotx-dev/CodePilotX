import type {
  Input,
  Part,
  PermissionMode,
  Run,
  SendStrategy,
  ServerEvent,
  SessionSnapshot,
  TaskMode,
} from '@codepilotx/shared'

export type { PermissionMode, SendStrategy, TaskMode }
export type TaskPhase = 'idle' | 'running' | 'waiting-permission' | 'waiting-question' | 'waiting-plan-confirmation' | 'completed' | 'failed' | 'stopped' | 'interrupted' | 'queued'
export type ProcessKind = 'thinking' | 'tool' | 'powershell' | 'write' | 'context'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  status?: 'active' | 'queued' | 'merged' | 'completed' | 'cancelled'
  taskMode?: TaskMode
}

export interface ProcessCommand {
  command: string
  output: string
  status?: 'success' | 'running' | 'error' | 'interrupted'
  truncated?: boolean
}

export interface ProcessItem {
  id: string
  kind: ProcessKind
  title: string
  detail: string
  commandCount?: number
  commands?: ProcessCommand[]
  state?: 'pending' | 'running' | 'completed' | 'error' | 'interrupted' | 'waiting-permission'
  createdAt: number
}

export interface TaskNarrative {
  id: string
  content: string
  createdAt: number
  hideOnComplete?: boolean
}

export interface EditedFile {
  path: string
  additions: number
  deletions: number
}

export interface EditResult {
  files: EditedFile[]
  totalFiles: number
  totalAdditions: number
  totalDeletions: number
  filesExpanded: boolean
  actionState: 'idle' | 'undone' | 'reviewed'
}

export interface TaskQuestionOption {
  id: string
  label: string
  recommended?: boolean
  description?: string
}

export interface TaskQuestion {
  id: string
  prompt: string
  options: TaskQuestionOption[]
  status: 'pending' | 'answered' | 'ignored' | 'cancelled'
  answer: string | null
}

export interface AiTask {
  id: string
  sourceMessageId: string
  mode: TaskMode
  mergedMessageIds: string[]
  phase: TaskPhase
  startedAt: number
  elapsedSeconds: number
  narratives: TaskNarrative[]
  processItems: ProcessItem[]
  pendingQuestion: TaskQuestion | null
  questions: TaskQuestion[]
  summary: string | null
  plan: string
  planAction: 'idle' | 'proposals-generated' | 'kept'
  processExpanded: boolean
  planExpanded: boolean
  editResult: EditResult | null
}

export interface ViewPreferences {
  processExpanded: Record<string, boolean>
  planExpanded: Record<string, boolean>
  filesExpanded: Record<string, boolean>
  editActions: Record<string, EditResult['actionState']>
  planActions: Record<string, 'idle' | 'proposals-generated' | 'kept'>
}

export const initialViewPreferences: ViewPreferences = {
  processExpanded: {},
  planExpanded: {},
  filesExpanded: {},
  editActions: {},
  planActions: {},
}

export function applyServerEvent(snapshot: SessionSnapshot, envelope: ServerEvent): SessionSnapshot {
  const event = envelope.event
  if (event.type === 'session.snapshot') return event.snapshot
  if (event.type === 'run.updated') return { ...snapshot, runs: upsert(snapshot.runs, event.run) }
  if (event.type === 'input.updated') return { ...snapshot, inputs: upsert(snapshot.inputs, event.input) }
  if (event.type === 'part.upserted') return { ...snapshot, parts: upsert(snapshot.parts, event.part) }
  if (event.type === 'permission.updated') {
    return { ...snapshot, permissions: upsert(snapshot.permissions, event.permission) }
  }
  if (event.type === 'question.updated') {
    return { ...snapshot, parts: upsert(snapshot.parts, event.question) }
  }
  return snapshot
}

function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  if (index < 0) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

export function projectConversation(snapshot: SessionSnapshot, preferences: ViewPreferences, now: number) {
  const messages = [...snapshot.inputs]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(inputToMessage)
  const runBySource = new Map(snapshot.runs.map((run) => [run.sourceInputID, run]))
  const tasks = messages
    .map((message) => runBySource.get(message.id))
    .filter((run): run is Run => run !== undefined && run.status !== 'queued')
    .map((run) => runToTask(run, snapshot.parts, preferences, now))
  const queuedMessages = messages.filter((message) => message.status === 'queued')
  return { messages, tasks, queuedMessages }
}

function inputToMessage(input: Input): ChatMessage {
  return {
    id: input.id,
    role: 'user',
    content: input.content,
    createdAt: input.createdAt,
    status: input.state,
    taskMode: input.mode,
  }
}

function runToTask(run: Run, allParts: readonly Part[], preferences: ViewPreferences, now: number): AiTask {
  const parts = allParts.filter((part) => part.runID === run.id).sort((a, b) => a.createdAt - b.createdAt)
  const completed = ['completed', 'failed', 'stopped', 'interrupted'].includes(run.status)
  const narratives: TaskNarrative[] = parts.flatMap((part) => {
    if (part.type === 'reasoning') {
      if (completed) return []
      return [{ id: part.id, content: part.text, createdAt: part.createdAt, hideOnComplete: true }]
    }
    if (part.type === 'text' && part.placement === 'process') {
      return [{ id: part.id, content: part.text, createdAt: part.createdAt }]
    }
    return []
  })
  const processItems = parts.flatMap(partToProcessItem)
  const summary = parts
    .flatMap((part) => part.type === 'text' && part.placement === 'result' ? [part.text] : [])
    .join('\n\n') || run.error || (run.status === 'stopped' ? '任务已停止，已保留当前执行记录。' : null)
  const plan = [...parts].reverse().find((part): part is Extract<Part, { type: 'plan' }> => part.type === 'plan')
  const questions = parts
    .filter((part): part is Extract<Part, { type: 'question' }> => part.type === 'question')
    .map((part) => ({
      id: part.id,
      prompt: part.prompt,
      options: part.choices.map((choice) => ({ ...choice })),
      status: part.status,
      answer: part.answer,
    }))
  const question = [...questions].reverse().find((item) => item.status === 'pending') ?? null
  const patch = [...parts].reverse().find((part): part is Extract<Part, { type: 'patch' }> => part.type === 'patch' && part.files.length > 0)
  const startedAt = run.startedAt ?? run.finishedAt ?? now
  const elapsedSeconds = run.finishedAt && run.startedAt
    ? Math.max(0, Math.floor((run.finishedAt - run.startedAt) / 1000))
    : run.startedAt ? Math.max(run.elapsedSeconds, Math.floor((now - run.startedAt) / 1000)) : run.elapsedSeconds

  return {
    id: run.id,
    sourceMessageId: run.sourceInputID,
    mode: run.mode,
    mergedMessageIds: [...run.mergedInputIDs],
    phase: normalizePhase(String(run.status)),
    startedAt,
    elapsedSeconds,
    narratives,
    processItems,
    pendingQuestion: question,
    questions,
    summary,
    plan: plan?.type === 'plan' ? plan.markdown : '',
    planAction: preferences.planActions[run.id] ?? 'idle',
    processExpanded: preferences.processExpanded[run.id] ?? true,
    planExpanded: preferences.planExpanded[run.id] ?? false,
    editResult: patch?.type === 'patch' ? {
      files: patch.files.map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions })),
      totalFiles: patch.files.length,
      totalAdditions: patch.totalAdditions,
      totalDeletions: patch.totalDeletions,
      filesExpanded: preferences.filesExpanded[run.id] ?? false,
      actionState: preferences.editActions[run.id] ?? 'idle',
    } : null,
  }
}

function normalizePhase(status: string): TaskPhase {
  if (status === 'waiting-plan-confirmation') return status
  if (['idle', 'running', 'waiting-permission', 'waiting-question', 'completed', 'failed', 'stopped', 'interrupted', 'queued'].includes(status)) return status as TaskPhase
  return 'failed'
}

function partToProcessItem(part: Part): ProcessItem[] {
  if (part.type === 'tool') {
    const command = part.command ?? describeToolInput(part.input)
    const verb = toolVerb(part.tool)
    return [{
      id: part.id,
      kind: part.tool === 'powershell.exec' ? 'powershell' : 'tool',
      title: part.state === 'running' || part.state === 'pending' ? `正在${verb}` : `已${verb}`,
      detail: part.error ?? part.output ?? part.title,
      state: part.state,
      commandCount: 1,
      commands: command ? [{
        command,
        output: part.error ?? part.output ?? (part.state === 'running' ? '命令仍在运行…' : ''),
        status: part.state === 'completed' ? 'success' : part.state === 'running' ? 'running' : part.state === 'error' ? 'error' : 'interrupted',
      }] : undefined,
      createdAt: part.createdAt,
    }]
  }
  if (part.type === 'activity') {
    const kind: ProcessKind = part.activity === 'context-compression' ? 'context' : part.activity === 'file-edit' ? 'write' : 'tool'
    return [{
      id: part.id,
      kind,
      title: part.title,
      detail: part.detail ?? '',
      state: part.status,
      commandCount: part.commands?.length,
      commands: part.commands?.map((command) => ({
        command: command.command,
        output: command.output,
        status: command.status,
        truncated: command.truncated,
      })),
      createdAt: part.createdAt,
    }]
  }
  return []
}

function toolVerb(tool: string): string {
  if (/propose.*patch|patch.*propose/i.test(tool)) return '提出补丁'
  if (/propose.*command|command.*propose/i.test(tool)) return '提出命令'
  if (/read|list|search|grep|find/i.test(tool)) return '读取工作区'
  return '使用只读工具'
}

function describeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const candidate = input as Record<string, unknown>
  if (typeof candidate.command === 'string') return candidate.command
  if (typeof candidate.path === 'string') return candidate.path
  try { return JSON.stringify(input, null, 2) } catch { return '' }
}
