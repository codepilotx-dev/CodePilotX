/**
 * Plan 模式最终方案的结构化提交契约。模型可见的 submit_plan 参数 schema、
 * 运行时校验与共享领域 schema 保持同一字段集合；Markdown 由共享格式化函数
 * 确定性派生，不是第二真源。
 */

import { Schema } from "effect"
import { StructuredPlanSchema, type StructuredPlan } from "@codepilotx/shared/thread"
import { Type } from "@earendil-works/pi-ai"
import { AgentError } from "../../domain"

/** 共享领域 schema 的字段名，用于校验模型可见参数未遗漏或新增字段。 */
export const structuredPlanDomainFields = Object.keys(StructuredPlanSchema.fields).sort()

const decodeStructuredPlanSync = Schema.decodeUnknownSync(StructuredPlanSchema, {
  onExcessProperty: "error",
})

/**
 * 校验一次 submit_plan 提交。非法形状、空文本和额外字段都抛出模型可修正的
 * 安全错误；错误信息不回显字段值。
 */
export const parseStructuredPlan = (input: unknown): StructuredPlan => {
  try {
    return decodeStructuredPlanSync(input) as StructuredPlan
  } catch {
    throw new AgentError(
      "INVALID_TOOL_INPUT",
      "结构化计划参数无效：字段缺失、为空或包含未知字段",
      400,
    )
  }
}

/**
 * submit_plan 的模型可见参数：只描述内容章节，不开放组件名、样式或任意
 * Renderer props。
 */
export const structuredPlanParameters = Type.Object(
  {
    title: Type.String({
      minLength: 1,
      description: "方案标题，一句话说明这个计划要达成什么",
    }),
    summary: Type.String({
      minLength: 1,
      description: "方案摘要，说明目标、范围与关键取舍",
    }),
    changes: Type.Array(
      Type.Object({
        area: Type.String({ minLength: 1, description: "实现变更涉及的模块或领域区域" }),
        items: Type.Array(
          Type.String({ minLength: 1, description: "该区域内一项具体变更" }),
          { minItems: 1, description: "该区域的变更项，至少一项" },
        ),
      }),
      { minItems: 1, description: "按区域分组的实现变更，至少一组" },
    ),
    interfaceChanges: Type.Array(
      Type.String({ minLength: 1, description: "接口、协议、数据或行为契约的变化" }),
      { description: "接口变化；没有就提交空数组" },
    ),
    tests: Type.Array(
      Type.String({ minLength: 1, description: "计划执行的验证或测试" }),
      { description: "测试与验证；没有就提交空数组" },
    ),
    assumptions: Type.Array(
      Type.String({ minLength: 1, description: "需要用户知晓的明确假设或边界" }),
      { description: "明确假设；没有就提交空数组" },
    ),
  },
  {
    description:
      "Plan 模式的最终方案。所有字段都必须提供，没有内容的列表提交空数组；提交成功即结束本轮。",
    additionalProperties: false,
  },
)
