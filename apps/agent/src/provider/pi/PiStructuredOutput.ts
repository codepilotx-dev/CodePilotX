import {
  contentText,
  Type,
  type Api,
  type Model as PiModel,
  type Models,
} from "@earendil-works/pi-ai";
import { z } from "zod";

const jsonPayload = (text: string) => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = fenced ?? trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Pi 模型没有返回有效 JSON");
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  }
};

export async function generatePiObject<TSchema extends z.ZodType>(input: {
  models: Models;
  model: PiModel<Api>;
  schema: TSchema;
  schemaName: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<z.output<TSchema>> {
  const toolName = `submit_${input.schemaName}`;
  const response = await input.models.completeSimple(
    input.model,
    {
      systemPrompt: [
        input.system,
        `必须调用 ${toolName} 提交符合 ${input.schemaName} 的结果，不要返回说明文字。`,
      ].join("\n"),
      messages: [
        { role: "user", content: input.prompt, timestamp: Date.now() },
      ],
      tools: [{
        name: toolName,
        description: `提交符合 ${input.schemaName} schema 的结构化结果`,
        parameters: Type.Unsafe(z.toJSONSchema(input.schema)),
        constrainedSampling: { type: "json_schema", strict: "prefer" },
      }],
    },
    {
      ...(input.signal ? { signal: input.signal } : {}),
      maxRetries: 1,
    },
  );
  if (response.stopReason === "error")
    throw new Error(response.errorMessage ?? "Pi 结构化模型调用失败");
  const toolCall = response.content.find(
    item => item.type === "toolCall" && item.name === toolName,
  );
  if (toolCall?.type === "toolCall")
    return input.schema.parse(toolCall.arguments);
  return input.schema.parse(jsonPayload(contentText(response.content, "\n")));
}
