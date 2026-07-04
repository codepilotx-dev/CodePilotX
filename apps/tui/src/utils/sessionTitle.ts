/**
 * Session title generation.
 *
 * TUI adapter for core's parameterized generateSessionTitle.
 * Provides the actual model query implementation using TUI's queryWithModel.
 */

import {
  generateSessionTitle as coreGenerateSessionTitle,
  extractConversationText,
} from '@codepilotx/core/session/title.js'
import type { TitleModelQueryParams } from '@codepilotx/core/session/title.js'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import { queryWithModel } from '../services/api/claude.js'
import { logForDebugging } from './debug.js'
import { extractTextContent } from './messages.js'
import { getMainLoopModel } from './model/model.js'
import { asSystemPrompt } from './systemPromptType.js'

export { extractConversationText }

/**
 * Generate a sentence-case session title from a description or first message.
 * Returns null on error or if the model returns an unparseable response.
 *
 * @param description - The user's first message or a description of the session
 * @param signal - Abort signal for cancellation
 * @param model - Optional model override (defaults to main loop model)
 */
export async function generateSessionTitle(
  description: string,
  signal: AbortSignal,
  model = getMainLoopModel(),
): Promise<string | null> {
  return coreGenerateSessionTitle(
    description,
    signal,
    async (params: TitleModelQueryParams) => {
      try {
        const result = await queryWithModel({
          systemPrompt: asSystemPrompt([params.systemPrompt]),
          userPrompt: params.userPrompt,
          outputFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
          signal: params.signal,
          options: {
            model,
            querySource: 'generate_session_title',
            agents: [],
            isNonInteractiveSession: getIsNonInteractiveSession(),
            hasAppendSystemPrompt: false,
            mcpTools: [],
          },
        })
        logEvent('tengu_session_title_generated', { success: true })
        return result as { message: { content: string | Array<{ type: string; text?: string }> } }
      } catch (error) {
        logForDebugging(`generateSessionTitle failed: ${error}`, {
          level: 'error',
        })
        logEvent('tengu_session_title_generated', { success: false })
        return null
      }
    },
  )
}
