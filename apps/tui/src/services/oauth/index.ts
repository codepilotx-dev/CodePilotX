/**
 * OAuth service that handles the OAuth 2.0 authorization code flow with PKCE.
 *
 * Re-exported from @codepilotx/core so both packages share the same
 * implementation.
 *
 * TUI provides the browser opener function when calling startOAuthFlow.
 */
export * from '@codepilotx/core/services/oauth/index.js'
