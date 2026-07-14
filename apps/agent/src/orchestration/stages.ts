import type { TaskMode } from "../domain"

export type AgentRole = "assistant" | "planner" | "developer" | "reviewer"

const planningIntent = /(?:实现|修复|修改|添加|创建|重构|开发|排查|设计|编写|代码|项目|功能|接口|测试|检查|分析|阅读|查找|定位|验证|运行|看看|帮我|请你|请帮|implement|fix|add|create|refactor|debug|investigate|design|code|feature|test|inspect|analy[sz]e|read|verify)/i
const casualConversation = /^(?:你好(?:呀|啊|哇)?[！!。.]?|嗨(?:呀|啊)?[！!。.]?|hello|hi|hey|谢谢|感谢|你是谁|在吗|早上好|晚上好)[\s，,。.!！?？]*$/i

/**
 * A greeting remains a normal conversation. Work requests enter planning first;
 * developer and reviewer are admitted only after the plan approval checkpoint.
 */
export const stagesForTask = (taskMode: TaskMode, content = ""): readonly AgentRole[] => {
  if (taskMode === "plan" || (!casualConversation.test(content.trim()) && planningIntent.test(content))) return ["planner"]
  return ["assistant"]
}
