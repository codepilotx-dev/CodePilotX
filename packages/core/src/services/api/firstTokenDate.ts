import axios from 'axios'
import { getOauthConfig } from '../oauth/constants.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

/**
 * Fetch the user's first CodePilotX token date and store in config.
 * This is called after successful login to cache when they started using CodePilotX.
 */
export async function fetchAndStoreCodePilotXFirstTokenDate(): Promise<void> {
  try {
    const config = getGlobalConfig()

    if (config.claudeCodeFirstTokenDate !== undefined) {
      return
    }

    const authHeaders = getCoreAuthHeaders()
    if (authHeaders.error) {
      console.error(`Failed to get auth headers: ${authHeaders.error}`)
      return
    }

    const oauthConfig = getOauthConfig()
    const url = `${oauthConfig.BASE_API_URL}/api/organization/claude_code_first_token_date`

    const response = await axios.get(url, {
      headers: {
        ...authHeaders.headers,
        'User-Agent': getCodePilotXUserAgent(),
      },
      timeout: 10000,
    })

    const firstTokenDate = response.data?.first_token_date ?? null

    // Validate the date if it's not null
    if (firstTokenDate !== null) {
      const dateTime = new Date(firstTokenDate).getTime()
      if (isNaN(dateTime)) {
        console.error(
          `Received invalid first_token_date from API: ${firstTokenDate}`,
        )
        // Don't save invalid dates
        return
      }
    }

    saveGlobalConfig(current => ({
      ...current,
      claudeCodeFirstTokenDate: firstTokenDate,
    }))
  } catch (error) {
    console.error('fetchAndStoreCodePilotXFirstTokenDate failed:', error)
  }
}

export const fetchAndStoreClaudeCodeFirstTokenDate =
  fetchAndStoreCodePilotXFirstTokenDate

/**
 * Get auth headers for core API requests.
 * Simplified version of the TUI getAuthHeaders that doesn't depend on
 * TUI-specific auth/OAuth modules.
 */
function getCoreAuthHeaders(): {
  headers: Record<string, string>
  error?: string
} {
  try {
    // Use x-api-key from config if available
    const config = getGlobalConfig()
    if (config.primaryApiKey) {
      return { headers: { 'x-api-key': config.primaryApiKey } }
    }

    // Try OAuth token from environment
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      return {
        headers: {
          Authorization: `Bearer ${process.env.CLAUDE_CODE_OAUTH_TOKEN}`,
        },
      }
    }

    return { headers: {} }
  } catch {
    return { headers: {}, error: 'Failed to get auth headers' }
  }
}

function getCodePilotXUserAgent(): string {
  return 'codepilotx/1.0'
}
