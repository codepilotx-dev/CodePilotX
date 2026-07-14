import { jsonSchema, stepCountIs, streamText, tool, type LanguageModel } from "ai"
import { aisdk } from "@openai/agents-extensions/ai-sdk"
import { Effect } from "effect"
import type { NormalizedLLMEvent, PermissionMode, TaskMode, ToolInvocation } from "../domain"
import type { ToolRegistry } from "../tool/ToolRegistry"

interface StreamRequest {
  sessionID: string
  runID: string
  content: string
  model: LanguageModel
  permissionMode: PermissionMode
  taskMode: TaskMode
  toolsEnabled: boolean
  signal: AbortSignal
  executeTool: (invocation: ToolInvocation, signal: AbortSignal) => Promise<unknown>
  prepareStep?: () => Promise<{ model?: LanguageModel; guidance?: string; permissionMode?: PermissionMode }>
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === "string" ? value : ""

export class LLMService {
  constructor(private readonly tools: ToolRegistry) {}

  async *stream(request: StreamRequest): AsyncGenerator<NormalizedLLMEvent> {
    let currentPermissionMode = request.permissionMode
    const definitions = request.toolsEnabled ? Object.fromEntries(this.tools.list(request.taskMode).map((definition) => [definition.name, tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      execute: async (input) => request.executeTool({
        id: crypto.randomUUID(),
        sessionID: request.sessionID,
        runID: request.runID,
        name: definition.name,
        input: record(input),
        permissionMode: currentPermissionMode,
        taskMode: request.taskMode,
      }, request.signal),
    })])) : {}

    const result = streamText({
      model: request.model,
      prompt: request.content,
      tools: definitions,
      stopWhen: stepCountIs(20),
      abortSignal: request.signal,
      ...(request.prepareStep ? { prepareStep: async ({ messages }) => {
        const update = await request.prepareStep?.()
        if (!update) return undefined
        if (update.permissionMode) currentPermissionMode = update.permissionMode
        return {
          ...(update.model ? { model: update.model } : {}),
          ...(update.guidance ? { messages: [...messages, { role: "user" as const, content: `用户补充要求：\n${update.guidance}` }] } : {}),
        }
      } } : {}),
    })
    try {
      for await (const raw of result.fullStream) {
        const chunk = record(raw)
        const type = text(chunk.type)
        const id = text(chunk.id || chunk.toolCallId) || crypto.randomUUID()
        switch (type) {
          case "text-start": yield { type, id }; break
          case "text-delta": yield { type, id, delta: text(chunk.text ?? chunk.delta) }; break
          case "text-end": yield { type, id }; break
          case "reasoning-start": yield { type, id }; break
          case "reasoning-delta": yield { type, id, delta: text(chunk.text ?? chunk.delta) }; break
          case "reasoning-end": yield { type, id }; break
          case "tool-input-start": yield { type, id, toolName: text(chunk.toolName) }; break
          case "tool-input-delta": yield { type, id, delta: text(chunk.delta) }; break
          case "tool-input-end": yield { type, id }; break
          case "tool-call": yield { type, id, toolName: text(chunk.toolName), input: chunk.input }; break
          case "tool-result": yield { type, id, output: chunk.output }; break
          case "tool-error": yield { type, id, error: chunk.error instanceof Error ? chunk.error.message : text(chunk.error) }; break
          case "start-step": yield { type: "step-start", id }; break
          case "finish-step": yield { type: "step-finish", id, ...(typeof chunk.finishReason === "string" ? { finishReason: chunk.finishReason } : {}) }; break
          case "finish": yield { type: "finish", ...(typeof chunk.finishReason === "string" ? { finishReason: chunk.finishReason } : {}) }; break
          case "error": yield { type: "provider-error", message: chunk.error instanceof Error ? chunk.error.message : String(chunk.error), retryable: false }; break
        }
      }
    } catch (cause) {
      if (request.signal.aborted) return
      yield { type: "provider-error", message: cause instanceof Error ? cause.message : String(cause), retryable: false }
    }
  }
}

/**
 * Reuses the application's existing AI SDK provider adapters with the Agents
 * SDK. Keeping this conversion here means API keys and provider-specific base
 * URLs continue to be owned by AdapterRegistry.
 */
export const asAgentModel = (model: LanguageModel) => aisdk(model as never)

export const runModelEffect = (request: StreamRequest, service: LLMService) => Effect.promise(async () => {
  const events: NormalizedLLMEvent[] = []
  for await (const event of service.stream(request)) events.push(event)
  return events
})
