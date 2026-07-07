/**
 * GitHub device-authorization flow for the TUI.
 *
 * Non-Electron implementation: requests a device code from GitHub,
 * shows the URL/user-code, polls for the access token, then exchanges
 * it for a CodePilotX application token and persists to shared credentials.
 */

import {
  exchangeGithubToken,
  resolveAuthBaseUrl,
} from '@codepilotx/core/services/oauth/githubExchange.js'
import { logForDebugging } from '../../utils/debug.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'

// ── Types ─────────────────────────────────────────────────────────────────

export type GithubDeviceFlowState =
  | { phase: 'idle' }
  | {
      phase: 'awaiting_device_code'
      deviceCode: string
      userCode: string
      verificationUri: string
      expiresAt: number
      intervalMs: number
      nextPollAt: number
      startedAt: number
    }
  | { phase: 'exchanging' }
  | { phase: 'completed'; message: string }
  | { phase: 'failed'; error: string }

export type GithubDeviceFlowResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

// ── Constants ─────────────────────────────────────────────────────────────

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const OAUTH_SCOPE = 'repo user'

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve GitHub OAuth client ID from env vars.
 */
function getGithubClientId(): string {
  return (
    process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID ??
    process.env.GITHUB_OAUTH_CLIENT_ID ??
    ''
  ).trim()
}

// ── Device Flow ───────────────────────────────────────────────────────────

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type TokenResponse =
  | { access_token: string; token_type: string; scope: string }
  | { error: string; error_description?: string }

/**
 * Start a GitHub device-authorization flow.
 * Returns the device code state for the caller to display and poll.
 */
export async function startGithubDeviceFlow(): Promise<GithubDeviceFlowState> {
  const clientId = getGithubClientId()
  if (!clientId) {
    return {
      phase: 'failed',
      error:
        'GitHub OAuth Client ID 未配置。\n' +
        '请设置 CODEPILOTX_GITHUB_OAUTH_CLIENT_ID 或 GITHUB_OAUTH_CLIENT_ID 环境变量。',
    }
  }

  try {
    const response = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ client_id: clientId, scope: OAUTH_SCOPE }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GitHub 设备授权码请求失败: ${text}`)
    }

    const device = (await response.json()) as DeviceCodeResponse

    return {
      phase: 'awaiting_device_code',
      deviceCode: device.device_code,
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresAt: Date.now() + device.expires_in * 1000,
      intervalMs: Math.max(device.interval, 1) * 1000,
      nextPollAt: Date.now(),
      startedAt: Date.now(),
    }
  } catch (error) {
    return {
      phase: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Poll the GitHub device-authorization endpoint for an access token.
 * Call this on a timer until the state transitions to 'exchanging' or 'failed'.
 */
export async function pollGithubDeviceFlow(
  state: GithubDeviceFlowState & { phase: 'awaiting_device_code' },
): Promise<GithubDeviceFlowState> {
  const clientId = getGithubClientId()
  if (!clientId) {
    return { phase: 'failed', error: 'GitHub Client ID 未配置。' }
  }

  // Check expiration
  if (Date.now() > state.expiresAt) {
    return { phase: 'failed', error: 'GitHub 授权码已过期，请重新开始登录。' }
  }

  // Check poll interval
  if (Date.now() < state.nextPollAt) {
    return state
  }

  try {
    const nextPollAt = Date.now() + state.intervalMs

    const response = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: state.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GitHub 轮询失败: ${text}`)
    }

    const tokenResponse = (await response.json()) as TokenResponse

    if ('access_token' in tokenResponse) {
      // Success! Now exchange for CodePilotX app token
      return await performExchange(tokenResponse.access_token, state)
    }

    switch (tokenResponse.error) {
      case 'authorization_pending':
        return { ...state, nextPollAt }
      case 'slow_down':
        return {
          ...state,
          intervalMs: state.intervalMs + 5000,
          nextPollAt: Date.now() + state.intervalMs + 5000,
        }
      case 'expired_token':
        return { phase: 'failed', error: 'GitHub 授权码已过期，请重新登录。' }
      case 'access_denied':
        return { phase: 'failed', error: 'GitHub 登录已取消。' }
      default:
        return {
          phase: 'failed',
          error:
            tokenResponse.error_description ??
            tokenResponse.error ??
            '未知错误',
        }
    }
  } catch (error) {
    return {
      phase: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Exchange the GitHub token for a CodePilotX app token and persist it.
 */
async function performExchange(
  githubToken: string,
  prevState: GithubDeviceFlowState & { phase: 'awaiting_device_code' },
): Promise<GithubDeviceFlowState> {
  try {
    // Fetch GitHub user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!userResponse.ok) {
      throw new Error(
        `获取 GitHub 用户信息失败: ${userResponse.status} ${userResponse.statusText}`,
      )
    }

    const githubUser = (await userResponse.json()) as {
      login: string
      id: number
      name?: string | null
      avatar_url?: string | null
    }

    // Exchange GitHub token for CodePilotX app token
    const appTokens = await exchangeGithubToken(
      {
        githubAccessToken: githubToken,
        githubUser: {
          login: githubUser.login,
          id: githubUser.id,
          name: githubUser.name ?? null,
          avatarUrl: githubUser.avatar_url ?? null,
        },
        client: 'tui',
      },
      undefined, // authBaseUrl — falls through to env/default
    )

    // Persist to shared credentials (same slot TUI reads)
    const secureStorage = getSecureStorage()
    const existing = secureStorage.read() || {}
    secureStorage.update({
      ...existing,
      claudeAiOauth: {
        accessToken: appTokens.accessToken,
        refreshToken: appTokens.refreshToken,
        expiresAt: appTokens.expiresAt ?? 0,
        scopes: appTokens.scopes,
        subscriptionType: null,
        rateLimitTier: null,
        source: 'github_exchange',
      },
    })

    return {
      phase: 'completed',
      message: `已通过 GitHub 账号 ${githubUser.login} 登录。`,
    }
  } catch (error) {
    return {
      phase: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
