export type DetectedShellCommandRisk = {
  risk: 'compound' | 'destructive'
  commandPreview: string
  commandPrefix: string
}

const DESTRUCTIVE_FRAGMENTS = [
  'rm -rf',
  'rm -fr',
  'rmdir',
  'format ',
  'mkfs',
  'dd if=',
  'shutdown',
  'reboot',
  'poweroff',
  'halt',
  'init 0',
  'chmod -r 777',
  'chmod -r 777',
  'chown -r',
  '> /dev/sd',
  '> /dev/hd',
  '> /dev/nvme',
  ':(){ :|:& };:',
] as const

const CHAIN_OPERATORS = ['&&', '||', ';', '|', '$(', '${', '`'] as const

export function detectShellCommandRisk(
  toolName: string,
  input: Record<string, unknown>,
): DetectedShellCommandRisk | null {
  if (toolName !== 'Bash' && toolName !== 'PowerShell') {
    return null
  }
  const rawCommand = readCommandFromInput(input)
  if (!rawCommand) {
    return null
  }
  const commandPreview = collapseWhitespace(rawCommand)
  if (!commandPreview) {
    return null
  }
  if (!hasChainOperator(commandPreview)) {
    return null
  }
  const firstSegment = firstShellSegment(commandPreview)
  const commandPrefix = firstSegment ? firstSegment.trim() : ''
  const isDestructive = isDestructiveCommand(commandPreview)
  return {
    risk: isDestructive ? 'destructive' : 'compound',
    commandPreview,
    commandPrefix: commandPrefix || firstShellWord(commandPreview),
  }
}

function readCommandFromInput(input: Record<string, unknown>): string | null {
  const candidates = [
    input.command,
    input.cmd,
    input.script,
    input.shell_command,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate
    }
  }
  return null
}

function hasChainOperator(command: string): boolean {
  if (!command) return false
  for (const op of CHAIN_OPERATORS) {
    if (command.includes(op)) {
      return true
    }
  }
  return false
}

function isDestructiveCommand(command: string): boolean {
  const lower = command.toLowerCase()
  for (const fragment of DESTRUCTIVE_FRAGMENTS) {
    if (lower.includes(fragment.toLowerCase())) {
      return true
    }
  }
  return false
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function firstShellSegment(command: string): string {
  for (const op of CHAIN_OPERATORS) {
    const index = command.indexOf(op)
    if (index > 0) {
      return command.slice(0, index)
    }
  }
  return command
}

function firstShellWord(command: string): string {
  const trimmed = command.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0] ?? ''
}
