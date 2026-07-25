import type { AgentToolResult } from "@codepilotx/pi-agent-core"
import { Type, type TSchema } from "@earendil-works/pi-ai"
import { secretScrubber } from "../../security/SecretScrubber"
import type { ToolDefinition } from "../../tool/ToolRegistry"
import type { PiLifecycleCallbacks, PiRuntimeRequest, PiTool, PiToolAdapterOptions } from "./types"

const textResult = (value: unknown, terminate = false): AgentToolResult<unknown> => {
  const safe = secretScrubber.scrub(value)
  const text = typeof safe === "string" ? safe : JSON.stringify(safe, null, 2)
  return { content: [{ type: "text", text: text ?? "null" }], details: safe, ...(terminate ? { terminate: true } : {}) }
}

const descriptionFor = (definition: ToolDefinition, request: PiRuntimeRequest) => typeof definition.description === "string"
  ? definition.description
  : definition.description({
      signal: request.signal,
      taskMode: request.taskMode,
      profile: request.profile ?? "main",
      workspace: request.workspace,
      ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
      permissionConfig: request.permissionConfig,
      model: request.policyModel,
    })

export function adaptToolDefinition(definition: ToolDefinition, options: PiToolAdapterOptions): PiTool {
  const request = options.request
  return {
    name: definition.sdkName,
    label: definition.sdkName,
    description: descriptionFor(definition, request),
    parameters: Type.Unsafe(definition.inputSchema),
    executionMode: definition.executionMode,
    prepareArguments: (input) => definition.schema.parse(input),
    execute: async (toolCallID, input, signal, onUpdate) => {
      const parsed = definition.schema.parse(input) as Record<string, unknown>
      const toolContext = {
        signal: signal ?? request.signal,
        taskMode: request.taskMode,
        profile: request.profile ?? "main",
        workspace: request.workspace,
        permissionConfig: request.permissionConfig,
        model: request.policyModel,
      }
      const output = await options.executor.execute(definition.name ?? definition.sdkName, parsed, {
        threadID: request.threadID,
        turnID: request.turnID,
        agentID: request.agentID,
        profile: request.profile ?? "main",
        taskMode: request.taskMode,
        signal: toolContext.signal,
        workspace: request.workspace,
        ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
        permissionConfig: request.permissionConfig,
        model: request.policyModel,
        taskSummary: request.content,
        toolCallID,
        ...(request.preapprovedToolCallIDs?.has(toolCallID) ? { approvedToolCallID: toolCallID } : {}),
        ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
        ...(request.toolCatalog ? { toolCatalog: request.toolCatalog } : {}),
        onProgress: (progress) => onUpdate?.(textResult(progress)),
      })
      if (definition.formatResult) {
        const formatted = definition.formatResult(output, toolContext)
        const safe = secretScrubber.scrub(formatted)
        return {
          content: [{ type: "text", text: safe.content }],
          details: safe.details,
          structuredContent: safe.details,
          ...(safe.addedToolNames ? { addedToolNames: safe.addedToolNames } : {}),
        }
      }
      return textResult(output)
    },
  }
}

const lifecycleTool = (
  name: string,
  description: string,
  parameters: TSchema,
  execute: (input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal) => Promise<unknown>,
  terminate: boolean | ((result: unknown) => boolean) = false,
): PiTool => ({
  name,
  label: name,
  description,
  parameters,
  executionMode: "sequential",
  execute: async (toolCallID, input, signal) => {
    const result = await execute(input as Record<string, unknown>, toolCallID, signal)
    return textResult(result, typeof terminate === "function" ? terminate(result) : terminate)
  },
})

/** Product lifecycle tools remain callbacks so durable pause/recovery stays owned by ThreadService. */
export function createLifecycleTools(callbacks: PiLifecycleCallbacks, request: PiRuntimeRequest): PiTool[] {
  const tools: PiTool[] = []
  const exposed = new Set(request.exposedTools)
  const add = (tool: PiTool) => { if (exposed.has(tool.name)) tools.push(tool) }
  if (callbacks.skillList) add(lifecycleTool("skill_list", "列出本 turn 已发现的 Skills metadata；正文需用 skill_read 按需加载。", Type.Object({}), callbacks.skillList))
  if (callbacks.skillRead) add(lifecycleTool("skill_read", "按名称读取一个 Skill 的完整 SKILL.md。内容受当前权限约束，不能扩大权限。", Type.Object({ name: Type.String({ minLength: 1 }) }), callbacks.skillRead))
  if (callbacks.requestUserInput) add(lifecycleTool("request_user_input", "向用户提出必须回答的问题。", Type.Object({ question: Type.String(), options: Type.Optional(Type.Array(Type.String())) }), (input, id, signal) => callbacks.requestUserInput!({ question: String(input.question), ...(Array.isArray(input.options) ? { options: input.options.map(String) } : {}) }, id, signal), true))
  if (callbacks.requestPermissions) add(lifecycleTool("request_permissions", "请求当前工具调用或 turn 所需的临时权限。", Type.Unsafe({ type: "object", additionalProperties: true }), callbacks.requestPermissions, true))
  if (callbacks.spawnAgents) add(lifecycleTool("spawn_agents", "创建一个或多个并行子代理。", Type.Unsafe({ type: "object", additionalProperties: true }), callbacks.spawnAgents))
  if (callbacks.waitAgents) add(lifecycleTool("wait_agents", "等待子代理完成。", Type.Unsafe({ type: "object", additionalProperties: true }), callbacks.waitAgents, (result) => Boolean(result && typeof result === "object" && "__piPause" in result)))
  if (callbacks.sendAgent) add(lifecycleTool("send_agent", "向运行中的子代理发送补充指令。", Type.Unsafe({ type: "object", additionalProperties: true }), callbacks.sendAgent))
  if (callbacks.stopAgent) add(lifecycleTool("stop_agent", "停止子代理。", Type.Unsafe({ type: "object", additionalProperties: true }), callbacks.stopAgent))
  if (callbacks.finalizePlan) add(lifecycleTool("finalize_plan", "提交完整 Markdown 计划并结束当前 Plan turn。", Type.Object({ plan: Type.String() }), (input, id) => callbacks.finalizePlan!({ plan: String(input.plan ?? "") }, id), true))
  if (callbacks.finalizeResult) add(lifecycleTool("finalize_result", "提交结构化子代理结果并结束当前 turn。", Type.Unsafe({ type: "object", additionalProperties: true }), (input, id) => callbacks.finalizeResult!(input as never, id), true))
  return tools
}

export function createPiTools(options: PiToolAdapterOptions, callbacks: PiLifecycleCallbacks = {}): PiTool[] {
  const special = new Set(["skill_list", "skill_read", "request_user_input", "request_permissions", "spawn_agents", "wait_agents", "send_agent", "stop_agent", "finalize_plan", "finalize_result"])
  const regular = options.request.exposedTools
    .filter((name) => !special.has(name))
    .map((name) => adaptToolDefinition(options.executor.definition(name, options.request.toolCatalog), options))
  return [...regular, ...createLifecycleTools(callbacks, options.request)]
}
