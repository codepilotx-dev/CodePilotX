import type {
  OAuthProfileResponse,
  OAuthTokenExchangeResponse,
  RateLimitTier,
  SubscriptionType,
} from './types.js'

const REMOVED_MESSAGE = 'Claude OAuth is removed from this build.'

export function shouldUseClaudeAIAuth(_scopes: string[] | undefined): boolean {
  return false
}

export function parseScopes(scopeString?: string): string[] {
  return scopeString?.split(' ').filter(Boolean) ?? []
}

export function buildAuthUrl(): string {
  throw new Error(REMOVED_MESSAGE)
}

export async function exchangeCodeForTokens(): Promise<OAuthTokenExchangeResponse> {
  throw new Error(REMOVED_MESSAGE)
}

export async function refreshOAuthToken(): Promise<OAuthTokenExchangeResponse> {
  throw new Error(REMOVED_MESSAGE)
}

export async function fetchAndStoreUserRoles(): Promise<void> {}

export async function createAndStoreApiKey(): Promise<string | null> {
  throw new Error(REMOVED_MESSAGE)
}

export function isOAuthTokenExpired(_expiresAt: number | null): boolean {
  return true
}

export async function fetchProfileInfo(): Promise<{
  subscriptionType: SubscriptionType | null
  rateLimitTier: RateLimitTier | null
  rawProfile: OAuthProfileResponse | undefined
}> {
  return {
    subscriptionType: null,
    rateLimitTier: null,
    rawProfile: undefined,
  }
}

export async function getOrganizationUUID(): Promise<string | null> {
  return null
}

export async function populateOAuthAccountInfoIfNeeded(): Promise<boolean> {
  return false
}

export function storeOAuthAccountInfo(): void {}
