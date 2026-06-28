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

export interface OAuthProfileResponse {
  id: string
  email: string
  name: string
  organizationId?: string
  subscriptionType?: SubscriptionType
}

export interface OAuthTokenExchangeResponse {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scope?: string
  tokenType?: string
}
