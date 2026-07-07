/**
 * GitHub OAuth → CodePilotX app token exchange.
 *
 * Both desktop and TUI use these helpers to exchange a GitHub device-flow token
 * for an application token that authenticates model/API calls. The app token
 * is stored in the shared `claudeAiOauth` secure-storage slot so existing
 * auth resolution remains centralized.
 */

import type { OAuthTokenExchangeResponse, OAuthTokens } from './types.js'

// ── Config ────────────────────────────────────────────────────────────────

/**
 * Resolve the CodePilotX auth backend base URL.
 *
 * Priority (first non-empty wins):
 *   1. `CODEPILOTX_AUTH_BASE_URL` env var
 *   2. Desktop setting `authBaseUrl` (must be injected at call site)
 *   3. Fallback (production)
 */
export function resolveAuthBaseUrl(
  settingUrl?: string | null,
): string {
  return (
    process.env.CODEPILOTX_AUTH_BASE_URL ??
    settingUrl?.trim() ??
    'https://auth.codepilotx.com'
  )
}

/**
 * Resolve the GitHub OAuth client ID.
 *
 * For desktop this comes from desktop settings; for TUI it falls back to env.
 */
export function resolveGithubClientId(
  preferredClientId?: string | null,
): string {
  if (preferredClientId?.trim()) return preferredClientId.trim()
  const env =
    process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID ??
    process.env.GITHUB_OAUTH_CLIENT_ID ??
    ''
  return env.trim()
}

// ── Types ─────────────────────────────────────────────────────────────────

export type GithubExchangeInput = {
  githubAccessToken: string
  githubUser: {
    login: string
    id: number
    name?: string | null
    avatarUrl?: string | null
  }
  client: 'desktop' | 'tui'
}

export type GithubExchangeResult = OAuthTokenExchangeResponse & {
  /** The application-level scopes granted to the exchanged token. */
  scope?: string
}

export type GithubExchangeTokens = OAuthTokens & {
  /** Tag identifying the token source. */
  source: 'github_exchange'
}

// ── Exchange ──────────────────────────────────────────────────────────────

/**
 * Exchange a GitHub access token (obtained via device flow) for a CodePilotX
 * application token.
 */
export async function exchangeGithubToken(
  input: GithubExchangeInput,
  authBaseUrl?: string | null,
): Promise<GithubExchangeTokens> {
  const baseUrl = resolveAuthBaseUrl(authBaseUrl)
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/github/exchange`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      github_access_token: input.githubAccessToken,
      github_user: input.githubUser,
      client: input.client,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `GitHub token exchange failed (${response.status}): ${body || response.statusText}`,
    )
  }

  const data = (await response.json()) as GithubExchangeResult

  const expiresAt = data.expires_in
    ? Date.now() + data.expires_in * 1000
    : null

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt,
    scopes: parseScopeString(data.scope),
    subscriptionType: null,
    rateLimitTier: null,
    source: 'github_exchange',
    tokenAccount: data.account
      ? {
          uuid: data.account.uuid,
          emailAddress: data.account.email_address,
          organizationUuid: data.organization?.uuid,
        }
      : undefined,
  }
}

// ── Token Refresh ─────────────────────────────────────────────────────────

/**
 * Refresh an expired CodePilotX application token using its refresh token.
 */
export async function refreshCodePilotToken(
  refreshToken: string,
  authBaseUrl?: string | null,
): Promise<GithubExchangeTokens> {
  const baseUrl = resolveAuthBaseUrl(authBaseUrl)
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/token`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `CodePilotX token refresh failed (${response.status}): ${body || response.statusText}`,
    )
  }

  const data = (await response.json()) as GithubExchangeResult

  const expiresAt = data.expires_in
    ? Date.now() + data.expires_in * 1000
    : null

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt,
    scopes: parseScopeString(data.scope),
    subscriptionType: null,
    rateLimitTier: null,
    source: 'github_exchange',
    tokenAccount: data.account
      ? {
          uuid: data.account.uuid,
          emailAddress: data.account.email_address,
          organizationUuid: data.organization?.uuid,
        }
      : undefined,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseScopeString(scope?: string): string[] {
  return scope?.split(' ').filter(Boolean) ?? ['user:inference']
}
