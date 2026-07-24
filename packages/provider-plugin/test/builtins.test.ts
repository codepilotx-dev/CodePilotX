import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  createBuiltinProviderPlugins,
  createPluginHost,
  type AuthRegistration,
  type BuiltinClock,
  type BuiltinFetch,
  type OAuthAuthRegistration,
} from "../src"

const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

const oauthRegistration = (
  registrations: readonly AuthRegistration[],
  integrationID: string,
): OAuthAuthRegistration => {
  const registration = registrations.find((item) =>
    item.integrationID === integrationID && item.method.type === "oauth")
  if (!registration || !("authorize" in registration)) {
    throw new Error(`Missing OAuth registration for ${integrationID}`)
  }
  return registration
}

describe("built-in provider plugins", () => {
  test("builds the OpenAI Codex PKCE URL and exchanges the submitted code", async () => {
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = []
    const claims = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
      email: "user@example.test",
      chatgpt_account_id: "account-1",
    })))
    const fetch: BuiltinFetch = async (input, init) => {
      requests.push({ url: requestURL(input), init })
      return jsonResponse({
        id_token: `header.${claims}.signature`,
        access_token: "openai-access",
        refresh_token: "openai-refresh",
        expires_in: 60,
      })
    }
    const clock: BuiltinClock = {
      now: () => 1_000,
      sleep: async () => undefined,
    }
    const host = createPluginHost({
      builtins: createBuiltinProviderPlugins({
        fetch,
        clock,
        openaiCodex: {
          issuer: "https://auth.example.test/",
          redirectURI: "http://localhost:3210/auth/callback",
        },
      }),
    })

    await Effect.runPromise(host.init())
    const integrations = await Effect.runPromise(host.integrations())
    expect(integrations.map((integration) => String(integration.id))).toEqual(["openai", "github-copilot"])
    expect(integrations.flatMap((integration) => integration.methods).every((method) => method.type === "oauth")).toBe(true)

    const registration = oauthRegistration(await Effect.runPromise(host.authRegistrations()), "openai")
    const authorization = await Effect.runPromise(registration.authorize({}))
    expect(authorization.mode).toBe("code")

    const authorizationURL = new URL(authorization.url)
    expect(authorizationURL.origin).toBe("https://auth.example.test")
    expect(authorizationURL.pathname).toBe("/oauth/authorize")
    expect(authorizationURL.searchParams.get("redirect_uri")).toBe("http://localhost:3210/auth/callback")
    expect(authorizationURL.searchParams.get("code_challenge_method")).toBe("S256")
    expect(authorizationURL.searchParams.get("codex_cli_simplified_flow")).toBe("true")

    if (authorization.mode !== "code") throw new Error("Expected code authorization")
    const credential = await Effect.runPromise(authorization.callback("submitted-code"))
    expect(credential).toMatchObject({
      type: "oauth",
      refresh: "openai-refresh",
      access: "openai-access",
      expires: 61_000,
      metadata: { accountID: "account-1", email: "user@example.test" },
    })
    expect(credential.type === "oauth" ? String(credential.methodID) : undefined).toBe("chatgpt-browser")

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe("https://auth.example.test/oauth/token")
    const body = new URLSearchParams(String(requests[0]?.init?.body))
    expect(body.get("code")).toBe("submitted-code")
    expect(body.get("redirect_uri")).toBe("http://localhost:3210/auth/callback")
    expect(body.get("code_verifier")).toHaveLength(43)
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier") ?? ""))
    expect(authorizationURL.searchParams.get("code_challenge")).toBe(base64UrlEncode(new Uint8Array(digest)))
  })

  test("polls GitHub Copilot device authorization with the injected base URL and clock", async () => {
    let now = 10_000
    const sleeps: number[] = []
    const requests: string[] = []
    const responses = [
      {
        verification_uri: "https://github.example.test/login/device",
        user_code: "ABCD-EFGH",
        device_code: "device-code",
        interval: 2,
        expires_in: 600,
      },
      { error: "authorization_pending" },
      { error: "slow_down", interval: 9 },
      { access_token: "copilot-access" },
      { token: "copilot-api-token", expires_at: 1234, endpoints: { api: "https://api.githubcopilot.test" } },
    ]
    const fetch: BuiltinFetch = async (input) => {
      requests.push(requestURL(input))
      return jsonResponse(responses.shift())
    }
    const clock: BuiltinClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
    }
    const host = createPluginHost({
      builtins: createBuiltinProviderPlugins({
        fetch,
        clock,
        githubCopilot: {
          baseURL: "https://github.example.test/",
          apiBaseURL: "https://api.github.example.test/",
          pollingSafetyMarginMs: 100,
        },
      }),
    })

    await Effect.runPromise(host.init())
    const registration = oauthRegistration(await Effect.runPromise(host.authRegistrations()), "github-copilot")
    const authorization = await Effect.runPromise(registration.authorize({ deploymentType: "github.com" }))
    expect(authorization).toMatchObject({
      mode: "auto",
      url: "https://github.example.test/login/device",
      instructions: "Enter code: ABCD-EFGH",
    })
    if (authorization.mode !== "auto") throw new Error("Expected automatic authorization")

    const credential = await Effect.runPromise(authorization.callback)
    expect(credential).toMatchObject({
      type: "oauth",
      refresh: "copilot-access",
      access: "copilot-api-token",
      expires: 1_234_000,
    })
    expect(credential.type === "oauth" ? String(credential.methodID) : undefined).toBe("github-copilot")
    expect(requests).toEqual([
      "https://github.example.test/login/device/code",
      "https://github.example.test/login/oauth/access_token",
      "https://github.example.test/login/oauth/access_token",
      "https://github.example.test/login/oauth/access_token",
      "https://api.github.example.test/copilot_internal/v2/token",
    ])
    expect(sleeps).toEqual([2_100, 9_100])
  })
})

function requestURL(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input)
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}
