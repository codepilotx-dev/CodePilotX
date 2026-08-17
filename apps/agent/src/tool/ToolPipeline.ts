import type { PermissionDecision } from "../domain"
import type { ToolCatalogEntry } from "./ToolRegistry"
import type { ToolExecutionContext } from "./ToolExecutor"

/**
 * ToolExecutor 统一工具执行管线的内部契约。
 *
 * 每个工具调用（注册工具与 Bash/PowerShell 共用）固定经过五个阶段：
 * 1. resolve   —— 解析定义、schema 校验、Shell/request_permissions 输入规范化，
 *                 以及 allowedTools、task mode、profile、已完成 toolCall 去重。
 * 2. inspect   —— 输入检查、路径与文件 mutation 分析、Shell 静态风险与禁用规则，
 *                 生成审批、Hook 与审计共享的 canonical invocation。
 * 3. authorize —— pre-tool Hook、权限策略、持久化审批与 Shell 授权，决策单调合并。
 * 4. execute   —— 调用注册工具执行体或 Shell 宿主执行器。
 * 5. finalize  —— 结果格式化、SecretScrubber、工具审计与 post Hook 恰好一次。
 */
export type ToolPipelinePhase = "resolve" | "inspect" | "authorize" | "execute" | "finalize"

export type ToolRisk = PermissionDecision["risk"]

/**
 * 贡献型 guard（pre-tool Hook、静态规则及未来的 guard 贡献）的合法结论。
 * 不允许返回"强制允许"；放行统一表示为 continue。
 */
export type ToolGuardResult =
  | { kind: "continue" }
  | { kind: "deny"; code: string; reason: string }
  | { kind: "require-approval"; risk: ToolRisk; reason: string }

/** resolve 阶段完成后冻结的调用快照，供 inspect/authorize/execute/finalize 共享。 */
export interface ResolvedToolInvocation {
  definition: ToolCatalogEntry
  canonicalName: string
  input: Record<string, unknown>
  context: ToolExecutionContext
  startedAt: number
}

/** 统一工具执行入口。ToolExecutor 是它的唯一公开实现与宿主入口。 */
export interface ToolExecutionPipeline {
  execute<T = unknown>(name: string, input: Record<string, unknown>, context: ToolExecutionContext): Promise<T>
}

/**
 * 决策单调合并：deny > require-approval > continue。
 * 后置结论不能覆盖更严格的前置结论；deny 与 require-approval 只能由后置 deny 升级。
 */
export function mergeToolGuards(guards: readonly ToolGuardResult[]): ToolGuardResult {
  let merged: ToolGuardResult = { kind: "continue" }
  for (const guard of guards) {
    if (merged.kind === "continue") {
      merged = guard
    } else if (guard.kind === "deny") {
      merged = guard
    }
  }
  return merged
}
