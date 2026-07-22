import {
  contentText,
  type Api,
  type Model as PiModel,
  type Models,
} from "@earendil-works/pi-ai";
import type { z } from "zod";

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

/** Pi does not expose a provider-independent JSON-schema response mode, so the
 * boundary requests JSON and treats the existing Zod schema as authoritative. */
export async function generatePiObject<TSchema extends z.ZodType>(input: {
  models: Models;
  model: PiModel<Api>;
  schema: TSchema;
  schemaName: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<z.output<TSchema>> {
  const response = await input.models.completeSimple(
    input.model,
    {
      systemPrompt: `${input.system}\n只返回符合 ${input.schemaName} 的 JSON 对象，不要使用 Markdown 代码围栏。`,
      messages: [
        { role: "user", content: input.prompt, timestamp: Date.now() },
      ],
    },
    {
      ...(input.signal ? { signal: input.signal } : {}),
      maxRetries: 1,
    },
  );
  if (response.stopReason === "error")
    throw new Error(response.errorMessage ?? "Pi 结构化模型调用失败");
  return input.schema.parse(jsonPayload(contentText(response.content, "\n")));
}
