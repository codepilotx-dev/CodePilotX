export type OAuthProvider = string

export interface OAuthToken {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
}

export interface OAuthSession {
  provider: OAuthProvider
  token: OAuthToken
  profile?: Record<string, unknown>
}

export type SubscriptionType =
  | 'free'
  | 'pro'
  | 'enterprise'
  | 'claudeai'
  | 'team'
  | 'max'

export type RateLimitTier = string | null

/** String-typed billing type from the OAuth profile endpoint. */
export type BillingType = string | null

/** API response from the OAuth token exchange endpoint. */
export interface OAuthTokenExchangeResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
  account?: {
    uuid: string
    email_address: string
  }
  organization?: {
    uuid: string
  }
}

/** API response from the OAuth profile endpoint. */
export interface OAuthProfileResponse {
  account: {
    uuid: string
    email: string
    display_name?: string
    created_at?: string
  }
  organization: {
    uuid: string
    organization_type?: string
    rate_limit_tier?: string
    has_extra_usage_enabled?: boolean
    billing_type?: string | null
    subscription_created_at?: string
  }
}

/** Internal representation of OAuth tokens with metadata. */
export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType: SubscriptionType | null
  rateLimitTier: RateLimitTier | null
  profile?: OAuthProfileResponse
  tokenAccount?: {
    uuid: string
    emailAddress: string
    organizationUuid?: string
  }
}

/** API response from the user roles endpoint. */
export interface UserRolesResponse {
  organization_role: string | null
  workspace_role: string | null
  organization_name: string | null
}
