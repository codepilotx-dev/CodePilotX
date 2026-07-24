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

const DEFAULT_BASE_URL = "https://github.com"
const DEFAULT_CLIENT_ID = "Ov23li8tweQw6odWQebz"
const DEFAULT_POLLING_SAFETY_MARGIN_MS = 3000
const DEFAULT_USER_AGENT = "CodePilotX"

const INTEGRATION_ID = Integration.ID.make("github-copilot")
const METHOD_ID = Integration.MethodID.make("github-copilot")

type DeviceResponse = {
  readonly verification_uri: string
  readonly user_code: string
  readonly device_code: string
  readonly interval?: number
  readonly expires_in?: number
}

type TokenResponse = {
  readonly access_token?: string
  readonly error?: string
  readonly interval?: number
}

type CopilotTokenResponse = {
  readonly token: string
  readonly expires_at?: number
  readonly endpoints?: { readonly api?: string }
}

export interface GitHubCopilotBuiltinOptions {
  readonly fetch?: BuiltinFetch
  readonly clock?: BuiltinClock
  readonly baseURL?: string
  readonly apiBaseURL?: string
  readonly clientID?: string
  readonly userAgent?: string
  readonly pollingSafetyMarginMs?: number
}

export function createGitHubCopilotBuiltin(options: GitHubCopilotBuiltinOptions = {}): Plugin {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const clock = options.clock ?? defaultBuiltinClock
  const defaultBaseURL = baseURL(options.baseURL ?? DEFAULT_BASE_URL)
  const defaultApiBaseURL = baseURL(options.apiBaseURL ?? (defaultBaseURL === DEFAULT_BASE_URL ? "https://api.github.com" : `${defaultBaseURL}/api/v3`))
  const clientID = options.clientID ?? DEFAULT_CLIENT_ID
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const pollingSafetyMarginMs = options.pollingSafetyMarginMs ?? DEFAULT_POLLING_SAFETY_MARGIN_MS
  const exchangeCopilotToken = async (githubToken: string, apiURL: string, metadata?: Record<string, unknown>) => {
    const copilot = await requestJSON<CopilotTokenResponse>(
      fetch,
      `${baseURL(apiURL)}/copilot_internal/v2/token`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${githubToken}`,
          "Editor-Version": "vscode/1.96.0",
          "Editor-Plugin-Version": "copilot-chat/0.26.0",
          "User-Agent": userAgent,
        },
      },
      "GitHub Copilot token exchange",
    )
    if (!copilot.token) throw new Error("GitHub Copilot token exchange returned no token")
    return Credential.OAuth.make({
      type: "oauth",
      methodID: METHOD_ID,
      refresh: githubToken,
      access: copilot.token,
      expires: Math.max(0, Math.trunc((copilot.expires_at ?? 0) * 1000)),
      metadata: metadata || copilot.endpoints?.api
        ? { ...(metadata ?? {}), ...(copilot.endpoints?.api ? { baseURL: copilot.endpoints.api } : {}) }
        : undefined,
    })
  }

  const registration: OAuthAuthRegistration = {
    integrationID: INTEGRATION_ID,
    method: {
      id: METHOD_ID,
      type: "oauth",
      label: "Login with GitHub Copilot",
      prompts: [
        {
          type: "select",
          key: "deploymentType",
          message: "Select GitHub deployment type",
          options: [
            { label: "GitHub.com", value: "github.com", hint: "Public" },
            { label: "GitHub Enterprise", value: "enterprise", hint: "Data residency or self-hosted" },
          ],
        },
        {
          type: "text",
          key: "enterpriseUrl",
          message: "Enter your GitHub Enterprise URL or domain",
          placeholder: "company.ghe.com or https://company.ghe.com",
          when: { key: "deploymentType", op: "eq", value: "enterprise" },
        },
      ],
    },
    authorize: (inputs) =>
      Effect.tryPromise({
        try: async () => {
          const deploymentType = inputs.deploymentType ?? "github.com"
          const enterpriseURL = deploymentType === "enterprise"
            ? normalizeEnterpriseURL(inputs.enterpriseUrl)
            : undefined
          const oauthBaseURL = enterpriseURL?.origin ?? defaultBaseURL
          const headers = {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": userAgent,
          }
          const device = await requestJSON<DeviceResponse>(
            fetch,
            `${oauthBaseURL}/login/device/code`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ client_id: clientID, scope: "read:user" }),
            },
            "GitHub device authorization",
          )
          let pollingIntervalMs = Math.max(device.interval ?? 5, 1) * 1000
          const expiresAt = device.expires_in === undefined
            ? undefined
            : clock.now() + Math.max(device.expires_in, 0) * 1000

          return {
            mode: "auto" as const,
            url: device.verification_uri,
            instructions: `Enter code: ${device.user_code}`,
            callback: Effect.tryPromise({
              try: async () => {
                while (expiresAt === undefined || clock.now() < expiresAt) {
                  const token = await requestJSON<TokenResponse>(
                    fetch,
                    `${oauthBaseURL}/login/oauth/access_token`,
                    {
                      method: "POST",
                      headers,
                      body: JSON.stringify({
                        client_id: clientID,
                        device_code: device.device_code,
                        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                      }),
                    },
                    "GitHub device token polling",
                  )
                  if (token.access_token) {
                    return exchangeCopilotToken(
                      token.access_token,
                      enterpriseURL ? `${enterpriseURL.origin}/api/v3` : defaultApiBaseURL,
                      enterpriseURL ? { enterpriseUrl: enterpriseURL.host } : undefined,
                    )
                  }
                  if (token.error === "slow_down") {
                    pollingIntervalMs = token.interval && token.interval > 0
                      ? token.interval * 1000
                      : pollingIntervalMs + 5000
                  } else if (token.error && token.error !== "authorization_pending") {
                    throw new Error(`GitHub device authorization failed: ${token.error}`)
                  }
                  await clock.sleep(pollingIntervalMs + pollingSafetyMarginMs)
                }
                throw new Error("GitHub device authorization expired")
              },
              catch: (cause) => cause,
            }),
          }
        },
        catch: (cause) => cause,
      }),
    refresh: (credential) => Effect.tryPromise({
      try: () => {
        const enterprise = typeof credential.metadata?.enterpriseUrl === "string" ? credential.metadata.enterpriseUrl : undefined
        return exchangeCopilotToken(
          credential.refresh,
          enterprise ? `https://${enterprise}/api/v3` : defaultApiBaseURL,
          credential.metadata ? { ...credential.metadata } : undefined,
        )
      },
      catch: (cause) => cause,
    }),
  }

  return define({
    id: "github-copilot",
    init: (context) =>
      Effect.gen(function* () {
        yield* context.integration.register({
          id: INTEGRATION_ID,
          name: "GitHub Copilot",
          methods: [registration.method],
          connections: [],
        })
        yield* context.auth.register(registration)
      }),
  })
}

function normalizeEnterpriseURL(value?: string): URL {
  const input = value?.trim()
  if (!input) throw new Error("GitHub Enterprise URL is required")
  const url = new URL(input.includes("://") ? input : `https://${input}`)
  if (url.protocol !== "https:" || !url.hostname) throw new Error("GitHub Enterprise URL must use HTTPS")
  return url
}
