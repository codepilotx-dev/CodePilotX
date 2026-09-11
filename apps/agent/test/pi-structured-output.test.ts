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
import {
  generatePiObject,
  PiStructuredOutputError,
} from "../src/provider/pi/PiStructuredOutput"

const schema = z.object({
  value: z.string(),
})

describe("PiStructuredOutput", () => {
  const officialOpenAIModel = {
    provider: "openai",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
  } as PiModel<Api>

  test("官方 OpenAI 强制唯一 strict 工具接收结构化结果", async () => {
    let capturedContext: Context | undefined
    let capturedOptions: Record<string, unknown> | undefined
    const models = {
      completeSimple: async (_model: PiModel<Api>, context: Context, options: Record<string, unknown>) => {
        capturedContext = context
        capturedOptions = options
        return fauxAssistantMessage(
          fauxToolCall("submit_example", { value: "structured" }),
          { stopReason: "toolUse" },
        )
      },
    } as unknown as Models

    const result = await generatePiObject({
      models,
      model: officialOpenAIModel,
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
      strict: "require",
    })
    const payload = await (capturedOptions?.onPayload as (payload: unknown) => unknown)({ model: "gpt-6-astra" })
    expect(payload).toEqual({
      model: "gpt-6-astra",
      tool_choice: { type: "function", name: "submit_example" },
    })
  })

  test("官方 OpenAI 缺少工具调用时返回稳定错误", async () => {
    const models = {
      completeSimple: async () => fauxAssistantMessage('{"value":"do not parse"}'),
    } as unknown as Models

    await expect(generatePiObject({
      models,
      model: officialOpenAIModel,
      schema,
      schemaName: "example",
      system: "生成示例",
      prompt: "开始",
    })).rejects.toMatchObject({
      name: "PiStructuredOutputError",
      code: "STRUCTURED_OUTPUT_MISSING",
    } satisfies Partial<PiStructuredOutputError>)
  })

  test("未调用工具的模型仍可使用 JSON 文本回退", async () => {
    const models = {
      completeSimple: async () =>
        fauxAssistantMessage('{"value":"fallback"}'),
    } as unknown as Models

    await expect(generatePiObject({
      models,
      model: {
        provider: "compatible",
        api: "openai-responses",
        baseUrl: "https://example.com/v1",
      } as PiModel<Api>,
      schema,
      schemaName: "example",
      system: "生成示例",
      prompt: "开始",
    })).resolves.toEqual({ value: "fallback" })
  })
})
