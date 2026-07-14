import { generateText } from "ai"
import type { Model } from "@codepilotx/model-schema"
import type { ProviderRuntime } from "@codepilotx/provider-runtime"
import { AgentError, type PermissionDecision, type ToolInvocation } from "../domain"
import type { AgentDatabase } from "../storage/Database"

const extractJSON = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  return JSON.parse((fenced ?? text).trim()) as Record<string, unknown>
}

export class ReviewerService {
  constructor(private readonly db: AgentDatabase, private readonly providers: ProviderRuntime) {}

  async review(invocation: ToolInvocation, signal: AbortSignal): Promise<PermissionDecision> {
    const ref = this.db.getSetting<Model.Ref>("reviewerModel")
    if (!ref) throw new AgentError("REVIEWER_NOT_CONFIGURED", "未配置独立审查模型", 409)
    await this.providers.resolve(ref)
    const model = await this.providers.getLanguage(ref)
    const response = await generateText({
      model,
      abortSignal: signal,
      system: "你是工具权限审查器。只输出 JSON：decision 为 allow、ask 或 deny；risk 为 low、medium 或 high；reason 为简短中文理由。重点防止数据丢失、凭据泄露、越权和不可逆系统修改。",
      prompt: JSON.stringify({ tool: invocation.name, input: invocation.input, taskMode: invocation.taskMode }),
    })
    const parsed = extractJSON(response.text)
    const decision = parsed.decision
    const risk = parsed.risk
    if (!(["allow", "ask", "deny"] as unknown[]).includes(decision) || !(["low", "medium", "high"] as unknown[]).includes(risk) || typeof parsed.reason !== "string") {
      throw new AgentError("REVIEWER_INVALID_RESPONSE", "审查模型返回了无效结构", 502)
    }
    return { decision: decision as PermissionDecision["decision"], risk: risk as PermissionDecision["risk"], reason: parsed.reason }
  }
}
