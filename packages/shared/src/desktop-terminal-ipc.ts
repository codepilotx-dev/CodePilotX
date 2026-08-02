export const DESKTOP_TERMINAL_IPC_CHANNELS = {
  listProfiles: "desktop-terminal:list-profiles",
  ensure: "desktop-terminal:ensure",
  attach: "desktop-terminal:attach",
  write: "desktop-terminal:write",
  resize: "desktop-terminal:resize",
  close: "desktop-terminal:close",
  closeThread: "desktop-terminal:close-thread",
  runAction: "desktop-terminal:run-action",
  event: "desktop-terminal:event",
} as const

export type DesktopTerminalState =
  | "starting"
  | "running"
  | "closing"
  | "exited"
  | "failed"

export type DesktopTerminalExitReason =
  | "process-exit"
  | "user-close"
  | "task-close"
  | "workspace-delete"
  | "app-quit"
  | "launch-failed"

export interface DesktopTerminalProfile {
  id: string
  label: string
  available: boolean
  isDefault: boolean
  unavailableReason?: string
}

export interface DesktopTerminalChunk {
  terminalId: string
  instanceId: string
  sequence: number
  data: string
}

export interface DesktopTerminalSnapshot {
  terminalId: string
  instanceId: string
  threadId: string
  displayPath: string
  profileId: string
  state: DesktopTerminalState
  oldestSequence: number
  nextSequence: number
  chunks: readonly DesktopTerminalChunk[]
  gap: boolean
  truncated: boolean
  contextChanged: boolean
  exitCode: number | null
  exitReason: DesktopTerminalExitReason | null
}

export type DesktopTerminalEvent =
  | { type: "output"; chunk: DesktopTerminalChunk }
  | {
      type: "state"
      terminalId: string
      instanceId: string
      state: DesktopTerminalState
      exitCode: number | null
      exitReason: DesktopTerminalExitReason | null
    }

export interface EnsureDesktopTerminalInput {
  threadId: string
  profileId: string | null
  cols: number
  rows: number
}

export interface AttachDesktopTerminalInput {
  terminalId: string
  instanceId: string
  afterSequence: number
}

export interface WriteDesktopTerminalInput {
  terminalId: string
  instanceId: string
  data: string
}

export interface ResizeDesktopTerminalInput {
  terminalId: string
  instanceId: string
  cols: number
  rows: number
}

export interface CloseDesktopTerminalInput {
  terminalId: string
  instanceId: string
  reason: "user-close" | "task-close" | "workspace-delete"
}

export interface CloseDesktopTerminalForThreadInput {
  threadId: string
  reason: "user-close" | "task-close" | "workspace-delete"
}

export interface RunDesktopTerminalActionInput {
  threadId: string
  actionName: string
  profileId: string | null
  cols: number
  rows: number
}

export interface DesktopTerminalIpcBridge {
  listTerminalProfiles(): Promise<readonly DesktopTerminalProfile[]>
  ensureTerminal(
    input: EnsureDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot>
  attachTerminal(
    input: AttachDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot>
  writeTerminal(input: WriteDesktopTerminalInput): void
  resizeTerminal(input: ResizeDesktopTerminalInput): void
  closeTerminal(
    input: CloseDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot>
  closeTerminalForThread(
    input: CloseDesktopTerminalForThreadInput,
  ): Promise<{ closed: boolean }>
  runTerminalAction(
    input: RunDesktopTerminalActionInput,
  ): Promise<DesktopTerminalSnapshot>
  onTerminalEvent(listener: (event: DesktopTerminalEvent) => void): () => void
}
