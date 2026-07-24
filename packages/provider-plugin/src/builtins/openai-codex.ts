import { Credential, Integration } from "@codepilotx/model-schema"
import { Effect } from "effect"
import type { OAuthAuthRegistration } from "../integration"
import { define, type Plugin } from "../plugin"
import {
  baseURL,
  defaultBuiltinClock,
  requestJSON,
  type BuiltinClock,
  type BuiltinFetch,
} from "./shared"

const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const DEFAULT_ISSUER = "https://auth.openai.com"
const DEFAULT_REDIRECT_URI = "http://localhost:1455/auth/callback"

const INTEGRATION_ID = Integration.ID.make("openai")
const METHOD_ID = Integration.MethodID.make("chatgpt-browser")

type Pkce = {
  readonly verifier: string
  readonly challenge: string
}

type TokenResponse = {
  readonly id_token?: string
  readonly access_token?: string
  readonly refresh_token?: string
  readonly expires_in?: number
}

type Claims = {
  readonly email?: string
  readonly chatgpt_account_id?: string
  readonly organizations?: ReadonlyArray<{ readonly id?: string }>
  readonly "https://api.openai.com/auth"?: { readonly chatgpt_account_id?: string }
}

export interface OpenAICodexBuiltinOptions {
  readonly fetch?: BuiltinFetch
  readonly clock?: BuiltinClock
  readonly issuer?: string
  readonly clientID?: string
  readonly redirectURI?: string
}

export function createOpenAICodexBuiltin(options: OpenAICodexBuiltinOptions = {}): Plugin {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const clock = options.clock ?? defaultBuiltinClock
  const issuer = baseURL(options.issuer ?? DEFAULT_ISSUER)
  const clientID = options.clientID ?? DEFAULT_CLIENT_ID
  const redirectURI = options.redirectURI ?? DEFAULT_REDIRECT_URI

  const toCredential = (tokens: TokenResponse, fallbackRefresh?: string) => {
    const access = tokens.access_token
    const refresh = tokens.refresh_token ?? fallbackRefresh
    if (!access || !refresh) throw new Error("OpenAI token response is missing required credentials")
    const claims = tokenClaims(tokens.id_token) ?? tokenClaims(tokens.access_token)
    const accountID = extractAccountID(claims)
    return Credential.OAuth.make({
      type: "oauth",
      methodID: METHOD_ID,
      refresh,
      access,
      expires: Math.max(0, Math.trunc(clock.now() + (tokens.expires_in ?? 3600) * 1000)),
      metadata: accountID || claims?.email
        ? {
            ...(accountID ? { accountID } : {}),
            ...(claims?.email ? { email: claims.email } : {}),
          }
        : undefined,
    })
  }

  const exchange = (code: string, pkce: Pkce) =>
    Effect.tryPromise({
      try: async () => {
        const tokens = await requestJSON<TokenResponse>(
          fetch,
          `${issuer}/oauth/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectURI,
              client_id: clientID,
              code_verifier: pkce.verifier,
            }).toString(),
          },
          "OpenAI token exchange",
        )
        return toCredential(tokens)
      },
      catch: (cause) => cause,
    })

  const registration: OAuthAuthRegistration = {
    integrationID: INTEGRATION_ID,
    method: {
      id: METHOD_ID,
      type: "oauth",
      label: "ChatGPT Pro/Plus (browser)",
    },
    authorize: () =>
      Effect.tryPromise({
        try: async () => {
          const pkce = await generatePKCE()
          const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
          const url = new URL(`${issuer}/oauth/authorize`)
          url.search = new URLSearchParams({
            response_type: "code",
            client_id: clientID,
            redirect_uri: redirectURI,
            scope: "openid profile email offline_access",
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            id_token_add_organizations: "true",
            codex_cli_simplified_flow: "true",
            state,
            originator: "opencode",
          }).toString()
          return {
            mode: "code" as const,
            url: url.toString(),
            instructions: "Complete authorization, then paste the code from the callback URL.",
            callback: (code: string) => exchange(code, pkce),
          }
        },
        catch: (cause) => cause,
      }),
    refresh: (credential) =>
      Effect.tryPromise({
        try: async () => {
          const tokens = await requestJSON<TokenResponse>(
            fetch,
            `${issuer}/oauth/token`,
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: credential.refresh,
                client_id: clientID,
              }).toString(),
            },
            "OpenAI token refresh",
          )
          const refreshed = toCredential(tokens, credential.refresh)
          return Credential.OAuth.make({
            ...refreshed,
            metadata: refreshed.metadata ?? credential.metadata,
          })
        },
        catch: (cause) => cause,
      }),
    label: (credential) => {
      const email = credential.metadata?.email
      return typeof email === "string" ? email : undefined
    },
  }

  return define({
    id: "openai-codex",
    init: (context) =>
      Effect.gen(function* () {
        yield* context.integration.register({
          id: INTEGRATION_ID,
          name: "OpenAI",
          methods: [registration.method],
          connections: [],
        })
        yield* context.auth.register(registration)
      }),
  })
}

async function generatePKCE(): Promise<Pkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(
    crypto.getRandomValues(new Uint8Array(43)),
    (byte) => chars[byte % chars.length],
  ).join("")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function tokenClaims(token?: string): Claims | undefined {
  const encoded = token?.split(".")[1]
  if (!encoded) return undefined
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as Claims
  } catch {
    return undefined
  }
}

function extractAccountID(claims?: Claims): string | undefined {
  return (
    claims?.chatgpt_account_id
    ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id
    ?? claims?.organizations?.[0]?.id
  )
}
