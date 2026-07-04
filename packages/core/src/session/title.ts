/**
 * Session title generation.
 *
 * Core implementation of AI-generated session titles.
 * The actual model querying is injected via a callback so that TUI
 * (which has the model infrastructure) can provide it without core
 * depending on TUI internals.
 */

import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'

const MAX_CONVERSATION_TEXT = 1000

/**
 * Flatten a message array into a single text string for title input.
 * Skips meta/non-human messages. Tail-slices to the last 1000 chars so
 * recent context wins when the conversation is long.
 */
export function extractConversationText(
  messages: Array<{ type: string; message: { content: string | unknown }; isMeta?: boolean; origin?: { kind: string } }>,
): string {
  const parts: string[] = []
  for (const msg of messages) {
    if (msg.type !== 'user' && msg.type !== 'assistant') continue
    if ('isMeta' in msg && msg.isMeta) continue
    if ('origin' in msg && msg.origin && msg.origin.kind !== 'human') continue
    const content = msg.message.content
    if (typeof content === 'string') {
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if ('type' in block && block.type === 'text' && 'text' in block) {
          parts.push(block.text as string)
        }
      }
    }
  }
  const text = parts.join('\n')
  return text.length > MAX_CONVERSATION_TEXT
    ? text.slice(-MAX_CONVERSATION_TEXT)
    : text
}

const SESSION_TITLE_PROMPT = `Generate a concise title that captures the main topic or goal of this coding session. The title should be clear enough that the user recognizes the session in a list.

Use the same primary language as the user's description. If the user writes in Chinese, return a natural Chinese title. If the user writes in English, return a concise sentence-case English title (capitalize only the first word and proper nouns). For mixed-language input, use the language that best matches the user's main request.

Return JSON with a single "title" field.

Good examples:
{"title": "Fix login button on mobile"}
{"title": "Add OAuth authentication"}
{"title": "Debug failing CI tests"}
{"title": "Refactor API client error handling"}
{"title": "询问当前模型"}
{"title": "修复侧边栏标题生成"}
{"title": "添加会话搜索功能"}

Bad (too vague): {"title": "Code changes"}
Bad (too long): {"title": "Investigate and fix the issue where the login button does not respond on mobile devices"}
Bad (wrong language): returning {"title": "Introduce your model"} for a Chinese request like "你是什么模型"
Bad (wrong case): {"title": "Fix Login Button On Mobile"}`

const titleSchema = lazySchema(() => z.object({ title: z.string() }))

/**
 * Parameters for the title generation model query.
 * TUI provides the actual model query implementation.
 */
export type TitleModelQueryParams = {
  systemPrompt: string
  userPrompt: string
  signal: AbortSignal
}

/**
 * Function signature for the model query.
 * TUI provides the implementation that calls queryWithModel.
 */
export type TitleModelQueryFn = (
  params: TitleModelQueryParams,
) => Promise<{ message: { content: string | Array<{ type: string; text?: string }> } } | null>

/**
 * Generate a sentence-case session title from a description or first message.
 * Returns null on error or if the model returns an unparseable response.
 *
 * @param description - The user's first message or a description of the session
 * @param signal - Abort signal for cancellation
 * @param modelQuery - Function to perform the actual model query
 */
export async function generateSessionTitle(
  description: string,
  signal: AbortSignal,
  modelQuery: TitleModelQueryFn,
): Promise<string | null> {
  const trimmed = description.trim()
  if (!trimmed) return null

  try {
    const result = await modelQuery({
      systemPrompt: SESSION_TITLE_PROMPT,
      userPrompt: trimmed,
      signal,
    })

    if (!result) return null

    const text = extractTextContent(result.message.content)
    const parsed = titleSchema().safeParse(safeParseJSON(text))
    const title = parsed.success ? parsed.data.title.trim() || null : null

    return title
  } catch (error) {
    return null
  }
}

function extractTextContent(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => b.type === 'text' && !!b.text)
      .map(b => b.text)
      .join('')
  }
  return ''
}

function safeParseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
