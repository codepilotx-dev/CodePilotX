import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  resolveAuthBaseUrl,
  resolveGithubClientId,
  exchangeGithubToken,
  refreshCodePilotToken,
} from './githubExchange.js'

// ── resolveAuthBaseUrl ────────────────────────────────────────────────────

describe('resolveAuthBaseUrl', () => {
  const originalEnv = process.env.CODEPILOTX_AUTH_BASE_URL

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CODEPILOTX_AUTH_BASE_URL
    } else {
      process.env.CODEPILOTX_AUTH_BASE_URL = originalEnv
    }
  })

  test('uses env var when no setting provided', () => {
    process.env.CODEPILOTX_AUTH_BASE_URL = 'https://auth.example.com'
    expect(resolveAuthBaseUrl()).toBe('https://auth.example.com')
  })

  test('env var takes priority over setting', () => {
    process.env.CODEPILOTX_AUTH_BASE_URL = 'https://env.example.com'
    // Even when a setting is provided, env var wins
    expect(resolveAuthBaseUrl('https://setting.example.com')).toBe(
      'https://env.example.com',
    )
  })

  test('falls back to default when nothing is set', () => {
    delete process.env.CODEPILOTX_AUTH_BASE_URL
    expect(resolveAuthBaseUrl()).toBe('https://auth.codepilotx.com')
  })

  test('empty setting string falls through to env var', () => {
    process.env.CODEPILOTX_AUTH_BASE_URL = 'https://env.example.com'
    expect(resolveAuthBaseUrl('')).toBe('https://env.example.com')
  })

  test('whitespace-only setting falls through to env var', () => {
    process.env.CODEPILOTX_AUTH_BASE_URL = 'https://env.example.com'
    expect(resolveAuthBaseUrl('   ')).toBe('https://env.example.com')
  })
})

// ── resolveGithubClientId ─────────────────────────────────────────────────

describe('resolveGithubClientId', () => {
  const originalEnv1 = process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID
  const originalEnv2 = process.env.GITHUB_OAUTH_CLIENT_ID

  afterEach(() => {
    process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID = originalEnv1
    process.env.GITHUB_OAUTH_CLIENT_ID = originalEnv2
  })

  test('preferred clientId takes priority', () => {
    expect(resolveGithubClientId('preferred-id')).toBe('preferred-id')
  })

  test('CODEPILOTX env var works', () => {
    process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID = 'codepilotx-client-id'
    delete process.env.GITHUB_OAUTH_CLIENT_ID
    expect(resolveGithubClientId()).toBe('codepilotx-client-id')
  })

  test('GITHUB env var as fallback', () => {
    delete process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID
    process.env.GITHUB_OAUTH_CLIENT_ID = 'github-client-id'
    expect(resolveGithubClientId()).toBe('github-client-id')
  })

  test('returns empty string when nothing is set', () => {
    delete process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID
    delete process.env.GITHUB_OAUTH_CLIENT_ID
    expect(resolveGithubClientId()).toBe('')
  })
})

// ── exchangeGithubToken ───────────────────────────────────────────────────

describe('exchangeGithubToken', () => {
  const mockExchangeResponse = {
    access_token: 'app-access-token-123',
    refresh_token: 'app-refresh-token-456',
    expires_in: 3600,
    scope: 'user:inference user:profile',
    account: {
      uuid: 'acct-uuid-1',
      email_address: 'user@example.com',
    },
    organization: {
      uuid: 'org-uuid-1',
    },
  }

  test('successfully exchanges GitHub token for app token', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockExchangeResponse), { status: 200 }),
      ),
    )
    // @ts-expect-error - mocking global fetch
    global.fetch = mockFetch

    const result = await exchangeGithubToken(
      {
        githubAccessToken: 'gh-token-123',
        githubUser: { login: 'testuser', id: 42, name: 'Test User' },
        client: 'tui',
      },
      'https://auth.test.com',
    )

    expect(result.accessToken).toBe('app-access-token-123')
    expect(result.refreshToken).toBe('app-refresh-token-456')
    expect(result.scopes).toEqual(['user:inference', 'user:profile'])
    expect(result.source).toBe('github_exchange')
    expect(result.tokenAccount?.uuid).toBe('acct-uuid-1')

    // Verify fetch was called with correct params
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://auth.test.com/api/auth/github/exchange')
    const body = JSON.parse(options.body as string)
    expect(body.github_access_token).toBe('gh-token-123')
    expect(body.github_user.login).toBe('testuser')
    expect(body.client).toBe('tui')
  })

  test('throws on non-200 response', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('Unauthorized', { status: 401 })),
    )
    // @ts-expect-error - mocking global fetch
    global.fetch = mockFetch

    await expect(
      exchangeGithubToken(
        {
          githubAccessToken: 'bad-token',
          githubUser: { login: 'testuser', id: 42 },
          client: 'desktop',
        },
        'https://auth.test.com',
      ),
    ).rejects.toThrow(/401/)
  })

  test('handles missing refresh token gracefully', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'app-token',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      ),
    )
    // @ts-expect-error - mocking global fetch
    global.fetch = mockFetch

    const result = await exchangeGithubToken(
      {
        githubAccessToken: 'gh-token',
        githubUser: { login: 'user', id: 1 },
        client: 'desktop',
      },
      'https://auth.test.com',
    )

    expect(result.accessToken).toBe('app-token')
    expect(result.refreshToken).toBeNull()
  })

  test('handles missing expires_in', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'app-token',
            refresh_token: 'refresh-token',
          }),
          { status: 200 },
        ),
      ),
    )
    // @ts-expect-error - mocking global fetch
    global.fetch = mockFetch

    const result = await exchangeGithubToken(
      {
        githubAccessToken: 'gh-token',
        githubUser: { login: 'user', id: 1 },
        client: 'desktop',
      },
      'https://auth.test.com',
    )

    expect(result.accessToken).toBe('app-token')
    expect(result.expiresAt).toBeNull()
  })
})

// ── refreshCodePilotToken ─────────────────────────────────────────────────

describe('refreshCodePilotToken', () => {
  const mockRefreshResponse = {
    access_token: 'refreshed-access-token',
    refresh_token: 'new-refresh-token',
    expires_in: 7200,
    scope: 'user:inference',
  }

  test('successfully refreshes token', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockRefreshResponse), { status: 200 }),
      ),
    )
    // @ts-expect-error - mocking global fetch
    global.fetch = mockFetch

    const result = await refreshCodePilotToken(
      'old-refresh-token',
      'https://auth.test.com',
    )

    expect(result.accessToken).toBe('refreshed-access-token')
    expect(result.refreshToken).toBe('new-refresh-token')
    expect(result.source).toBe('github_exchange')

    // Verify correct endpoint
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://auth.test.com/api/auth/token')
    const body = JSON.parse(options.body as string)
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('old-refresh-token')
  })

  test('keeps old refresh token when none returned', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'new-access-token',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      ),
    )
    // @ts-expect-error - mocking global fetch
    global.fetch = mockFetch

    const result = await refreshCodePilotToken(
      'old-refresh-token',
      'https://auth.test.com',
    )

    expect(result.accessToken).toBe('new-access-token')
    expect(result.refreshToken).toBe('old-refresh-token')
  })

  test('throws on refresh failure', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('Token expired', { status: 401 })),
    )
    // @ts-expect-error - mocking global fetch
    global.fetch = mockFetch

    await expect(
      refreshCodePilotToken('bad-token', 'https://auth.test.com'),
    ).rejects.toThrow(/401/)
  })
})
