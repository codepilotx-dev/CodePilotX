import { StructuredIO } from '../../cli/structuredIO.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
  StdoutMessage,
} from '../../entrypoints/sdk/controlTypes.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type {
  DesktopAgentEvent,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
} from '../shared/types.js'

type DesktopStructuredIOOptions = {
  sessionId: string
  emit(event: DesktopAgentEvent): void
  requestPermission(request: DesktopPermissionRequest): Promise<DesktopPermissionDecision>
}

export type DesktopStructuredIOHost = {
  structuredIO: StructuredIO
  input: AsyncIterable<string>
  pushUserMessage(content: string): void
  close(): void
}

class AsyncLineQueue implements AsyncIterable<string> {
  private closed = false
  private readonly lines: string[] = []
  private readonly waiters: Array<(value: IteratorResult<string>) => void> = []

  push(line: string): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value: line })
      return
    }
    this.lines.push(line)
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        const line = this.lines.shift()
        if (line !== undefined) {
          return Promise.resolve({ done: false, value: line })
        }
        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined })
        }
        return new Promise(resolve => this.waiters.push(resolve))
      },
    }
  }
}

export function createDesktopStructuredIO(
  options: DesktopStructuredIOOptions,
): DesktopStructuredIOHost {
  const input = new AsyncLineQueue()
  let structuredIO: StructuredIO

  structuredIO = new StructuredIO(input, true, {
    writeMessage: async message => {
      await handleStructuredOutput(message, options, response => {
        structuredIO.injectControlResponse(response)
      })
    },
  })

  return {
    structuredIO,
    input,
    pushUserMessage(content: string): void {
      input.push(
        jsonStringify({
          type: 'user',
          session_id: options.sessionId,
          message: {
            role: 'user',
            content,
          },
          parent_tool_use_id: null,
        }) + '\n',
      )
    },
    close(): void {
      input.close()
    },
  }
}

async function handleStructuredOutput(
  message: StdoutMessage,
  options: DesktopStructuredIOOptions,
  injectControlResponse: (response: SDKControlResponse) => void,
): Promise<void> {
  switch (message.type) {
    case 'assistant':
      emitAssistantMessage(message, options)
      break
    case 'user':
      break
    case 'system':
      emitSystemMessage(message, options)
      break
    case 'result':
      options.emit({ type: 'done', sessionId: options.sessionId })
      break
    case 'control_request':
      await handleControlRequest(message, options, injectControlResponse)
      break
    case 'control_cancel_request':
    case 'keep_alive':
      break
    default:
      options.emit({
        type: 'message',
        sessionId: options.sessionId,
        role: 'system',
        text: jsonStringify(message),
      })
  }
}

function emitAssistantMessage(
  message: Extract<StdoutMessage, { type: 'assistant' }>,
  options: DesktopStructuredIOOptions,
): void {
  const content = message.message?.content
  if (!Array.isArray(content)) {
    return
  }

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type === 'text' && typeof item.text === 'string') {
      options.emit({
        type: 'message',
        sessionId: options.sessionId,
        role: 'assistant',
        text: item.text,
      })
    } else if (item.type === 'tool_use') {
      const toolName = typeof item.name === 'string' ? item.name : 'Tool'
      options.emit({
        type: 'tool_start',
        sessionId: options.sessionId,
        toolName,
        summary: summarizeToolInput(toolName, item.input),
      })
    }
  }
}

function emitSystemMessage(
  message: Extract<StdoutMessage, { type: 'system' }>,
  options: DesktopStructuredIOOptions,
): void {
  const subtype = 'subtype' in message ? String(message.subtype) : 'system'
  options.emit({
    type: 'message',
    sessionId: options.sessionId,
    role: 'system',
    text: subtype,
  })
}

async function handleControlRequest(
  message: SDKControlRequest,
  options: DesktopStructuredIOOptions,
  injectControlResponse: (response: SDKControlResponse) => void,
): Promise<void> {
  if (message.request?.subtype !== 'can_use_tool') {
    injectControlResponse({
      type: 'control_response',
      response: {
        request_id: message.request_id,
        subtype: 'error',
        error: `Unsupported control request: ${message.request?.subtype}`,
      },
    })
    return
  }

  const decision = await options.requestPermission({
    requestId: message.request_id,
    toolName: message.request.tool_name,
    input: message.request.input ?? {},
    description:
      message.request.description ??
      summarizeToolInput(message.request.tool_name, message.request.input),
  })

  injectControlResponse({
    type: 'control_response',
    response:
      decision.behavior === 'allow'
        ? {
            request_id: message.request_id,
            subtype: 'success',
            response: {
              behavior: 'allow',
              updatedInput: {},
              toolUseID: message.request.tool_use_id,
            },
          }
        : {
            request_id: message.request_id,
            subtype: 'error',
            error: decision.message ?? 'Permission denied',
          },
  })
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return toolName
  }
  const record = input as Record<string, unknown>
  const target =
    record.file_path ??
    record.filePath ??
    record.pattern ??
    record.command ??
    record.url ??
    record.query
  return typeof target === 'string' ? `${toolName}: ${target}` : toolName
}
