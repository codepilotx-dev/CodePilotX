import { describe, expect, test } from "bun:test"
import {
  fauxAssistantMessage,
  fauxToolCall,
  type Api,
  type Context,
  type Model as PiModel,
  type Models,
} from "@earendil-works/pi-ai"
import { z } from "zod"
import { generatePiObject } from "../src/provider/pi/PiStructuredOutput"

const schema = z.object({
  value: z.string(),
})

describe("PiStructuredOutput", () => {
  test("通过带 JSON schema 约束的工具接收结构化结果", async () => {
    let capturedContext: Context | undefined
    const models = {
      completeSimple: async (_model: PiModel<Api>, context: Context) => {
        capturedContext = context
        return fauxAssistantMessage(
          fauxToolCall("submit_example", { value: "structured" }),
          { stopReason: "toolUse" },
        )
      },
    } as unknown as Models

    const result = await generatePiObject({
      models,
      model: {} as PiModel<Api>,
      schema,
      schemaName: "example",
      system: "生成示例",
      prompt: "开始",
    })

    expect(result).toEqual({ value: "structured" })
    expect(capturedContext?.tools).toHaveLength(1)
    expect(capturedContext?.tools?.[0]?.name).toBe("submit_example")
    expect(capturedContext?.tools?.[0]?.constrainedSampling).toEqual({
      type: "json_schema",
      strict: "prefer",
    })
  })

  test("未调用工具的模型仍可使用 JSON 文本回退", async () => {
    const models = {
      completeSimple: async () =>
        fauxAssistantMessage('{"value":"fallback"}'),
    } as unknown as Models

    await expect(generatePiObject({
      models,
      model: {} as PiModel<Api>,
      schema,
      schemaName: "example",
      system: "生成示例",
      prompt: "开始",
    })).resolves.toEqual({ value: "fallback" })
  })
})
