import * as React from 'react'
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  getClaudeAIOAuthTokens,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { openBrowser } from '../../utils/browser.js'
import { logError } from '../../utils/log.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
): Promise<React.ReactNode | null> {
  try {
    // Check if user is already on the highest Max plan (20x)
    if (isClaudeAISubscriber()) {
      const tokens = getClaudeAIOAuthTokens()
      let isMax20x = false

      if (tokens?.subscriptionType && tokens?.rateLimitTier) {
        isMax20x =
          tokens.subscriptionType === 'max' &&
          tokens.rateLimitTier === 'default_claude_max_20x'
      } else if (tokens?.accessToken) {
        const profile = await getOauthProfileFromOauthToken(tokens.accessToken)
        isMax20x =
          profile?.organization?.organization_type === 'claude_max' &&
          profile?.organization?.rate_limit_tier === 'default_claude_max_20x'
      }

      if (isMax20x) {
        setTimeout(
          onDone,
          0,
          'You are already on the highest Max subscription plan. For additional usage, set ANTHROPIC_API_KEY or configure provider credentials.',
        )
        return null
      }
    }

    const url = 'https://claude.ai/upgrade/max'
    await openBrowser(url)

    onDone('Opened upgrade page. OAuth login is disabled in this build; set ANTHROPIC_API_KEY or configure provider credentials after upgrading.')
    return null
  } catch (error) {
    logError(error as Error)
    setTimeout(
      onDone,
      0,
      'Failed to open browser. Please visit https://claude.ai/upgrade/max to upgrade.',
    )
  }
  return null
}
