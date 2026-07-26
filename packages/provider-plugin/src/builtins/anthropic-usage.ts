import { Credential, Integration } from "@codepilotx/model-schema"
import { Effect } from "effect"
import type { OAuthAuthRegistration } from "../integration"
import { define, type Plugin } from "../plugin"
import {
  defaultBuiltinClock,
  type BuiltinClock,
  type BuiltinFetch,
} from "./shared"

const AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize"
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback"
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const SCOPES = "user:profile user:inference"
const INTEGRATION_ID = Integration.ID.make("usage.anthropic.subscription")
const METHOD_ID = Integration.MethodID.make("claude-subscription-browser")

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

export interface AnthropicUsageBuiltinOptions {
  readonly fetch?: BuiltinFetch
  readonly clock?: BuiltinClock
}

const base64UrlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const generatePKCE = async () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(
    crypto.getRandomValues(new Uint8Array(64)),
    (byte) => chars[byte % chars.length],
  ).join("")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

const parseTokenResponse = async (
  response: Response,
  operation: string,
  requireRefresh: boolean,
) => {
  if (response.status >= 300 && response.status < 400) throw new Error(`${operation} rejected a redirect`)
  if (!response.ok) throw new Error(`${operation} failed (${response.status})`)
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > 1024 * 1024) throw new Error(`${operation} response is too large`)
  let raw: string
  if (response.body) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 1024 * 1024) {
        await reader.cancel()
        throw new Error(`${operation} response is too large`)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    raw = new TextDecoder().decode(bytes)
  } else {
    raw = await response.text()
    if (new TextEncoder().encode(raw).byteLength > 1024 * 1024) throw new Error(`${operation} response is too large`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`${operation} returned invalid JSON`)
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${operation} returned an invalid token response`)
  }
  const value = parsed as TokenResponse
  if (
    typeof value.access_token !== "string"
    || !value.access_token.trim()
    || (requireRefresh && (typeof value.refresh_token !== "string" || !value.refresh_token.trim()))
    || typeof value.expires_in !== "number"
    || !Number.isFinite(value.expires_in)
    || value.expires_in < 0
    || (value.scope !== undefined && typeof value.scope !== "string")
  ) {
    throw new Error(`${operation} returned an invalid token response`)
  }
  return value
}

export function createAnthropicUsageBuiltin(options: AnthropicUsageBuiltinOptions = {}): Plugin {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const clock = options.clock ?? defaultBuiltinClock
  const toCredential = (tokens: TokenResponse, fallbackRefresh?: string) => {
    const access = tokens.access_token
    const refresh = tokens.refresh_token ?? fallbackRefresh
    if (!access || !refresh) throw new Error("Anthropic token response is missing credentials")
    return Credential.OAuth.make({
      type: "oauth",
      methodID: METHOD_ID,
      access,
      refresh,
      expires: Math.max(0, Math.trunc(clock.now() + (tokens.expires_in ?? 3600) * 1000)),
      metadata: { scopes: tokens.scope ?? SCOPES },
    })
  }
  const registration: OAuthAuthRegistration = {
    integrationID: INTEGRATION_ID,
    method: {
      id: METHOD_ID,
      type: "oauth",
      label: "Claude 订阅（实验性）",
    },
    authorize: () => Effect.tryPromise({
      try: async () => {
        const pkce = await generatePKCE()
        const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
        const url = new URL(AUTHORIZE_URL)
        url.search = new URLSearchParams({
          code: "true",
          client_id: CLIENT_ID,
          response_type: "code",
          redirect_uri: REDIRECT_URI,
          scope: SCOPES,
          code_challenge: pkce.challenge,
          code_challenge_method: "S256",
          state,
        }).toString()
        return {
          mode: "code" as const,
          url: url.toString(),
          instructions: "在浏览器完成授权，然后粘贴回调页面显示的授权码。",
          callback: (rawCode: string) => Effect.tryPromise({
            try: async () => {
              const [code, returnedState] = rawCode.trim().split("#", 2)
              if (!code || returnedState !== state) throw new Error("Anthropic OAuth code is invalid")
              const response = await fetcher(TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  grant_type: "authorization_code",
                  code,
                  redirect_uri: REDIRECT_URI,
                  client_id: CLIENT_ID,
                  code_verifier: pkce.verifier,
                  state,
                }),
                redirect: "manual",
                signal: AbortSignal.timeout(8_000),
              })
              return toCredential(await parseTokenResponse(response, "Anthropic token exchange", true))
            },
            catch: (cause) => cause,
          }),
        }
      },
      catch: (cause) => cause,
    }),
    refresh: (credential) => Effect.tryPromise({
      try: async () => {
        const response = await fetcher(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: credential.refresh,
            client_id: CLIENT_ID,
            scope: SCOPES,
          }),
          redirect: "manual",
          signal: AbortSignal.timeout(8_000),
        })
        const value = await parseTokenResponse(response, "Anthropic token refresh", false)
        return toCredential({ ...value, refresh_token: value.refresh_token ?? credential.refresh }, credential.refresh)
      },
      catch: (cause) => cause,
    }),
  }

  return define({
    id: "anthropic-usage",
    init: (context) => Effect.gen(function* () {
      yield* context.integration.register({
        id: INTEGRATION_ID,
        name: "Claude 订阅用量",
        methods: [registration.method],
        connections: [],
      })
      yield* context.auth.register(registration)
    }),
  })
}
