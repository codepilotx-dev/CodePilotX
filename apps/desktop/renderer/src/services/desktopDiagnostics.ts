export interface AgentDiagnostic {
  at: string
  level: 'info' | 'warn' | 'error'
  source: 'agent' | 'desktop'
  code: string
  message: string
  details?: {
    phase?: string
    durationMs?: number
    failureCount?: number
    attempt?: number
    toolCallId?: string
  }
}

export interface AgentDiagnosticBridge {
  onAgentDiagnostic?(listener: (diagnostic: AgentDiagnostic) => void): () => void
}

export interface DiagnosticConsole {
  info(...values: unknown[]): void
  warn(...values: unknown[]): void
  error(...values: unknown[]): void
}

export function subscribeToDesktopDiagnostics(
  bridge: AgentDiagnosticBridge | undefined,
  output: DiagnosticConsole = console,
): () => void {
  if (!bridge?.onAgentDiagnostic) return () => undefined
  return bridge.onAgentDiagnostic((diagnostic) => {
    const label = `[CodePilotX][${diagnostic.source}] ${diagnostic.code}: ${diagnostic.message}`
    const values = diagnostic.details ? [label, diagnostic.details] : [label]
    output[diagnostic.level](...values)
  })
}
