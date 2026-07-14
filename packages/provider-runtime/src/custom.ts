import type { Credential, Provider } from "@codepilotx/model-schema"
import type { CustomProviderContext } from "./types"

export const BUILTIN_CUSTOM_PROVIDERS = Object.freeze([
  "cloudflare-workers-ai",
  "cloudflare-ai-gateway",
  "snowflake-cortex",
  "sap-ai-core",
  "github-copilot",
] as const)

export interface BuiltinCustomResult {
  readonly configured: boolean
  readonly options: Readonly<Record<string, unknown>>
  readonly error?: string
}

const key = (credential: Credential.Value | string | undefined) => {
  if (typeof credential === "string") return credential
  if (credential?.type === "key") return credential.key
  if (credential?.type === "oauth") return credential.access
  return undefined
}

const metadata = (credential: Credential.Value | string | undefined, name: string) =>
  typeof credential === "object" && credential?.metadata && typeof credential.metadata[name] === "string"
    ? credential.metadata[name]
    : undefined

export function builtinCustomOptions(context: CustomProviderContext): BuiltinCustomResult | undefined {
  const id = String(context.provider.id)
  const env = context.env
  const token = key(context.credential)
  const oauth = typeof context.credential === "object" && context.credential?.type === "oauth" ? context.credential : undefined
  if (id === "openai" && oauth && String(oauth.methodID) === "chatgpt-browser") {
    const accountID = metadata(oauth, "accountID")
    return {
      configured: true,
      options: {
        apiKey: oauth.access,
        baseURL: "https://chatgpt.com/backend-api/codex",
        ...(accountID ? { headers: { "ChatGPT-Account-Id": accountID } } : {}),
      },
    }
  }
  if (id === "github-copilot") {
    const apiKey = token ?? env.GITHUB_COPILOT_TOKEN ?? env.GITHUB_TOKEN
    const credentialBaseURL = metadata(context.credential, "baseURL")
    return {
      configured: Boolean(apiKey),
      options: {
        name: "github-copilot",
        baseURL: env.GITHUB_COPILOT_BASE_URL ?? credentialBaseURL ?? context.provider.api.url ?? "https://api.githubcopilot.com",
        ...(apiKey ? { apiKey } : {}),
        headers: {
          "Copilot-Integration-Id": "vscode-chat",
          "Editor-Version": "CodePilotX/0.1.0",
          "Openai-Intent": "conversation-panel",
        },
      },
      ...(apiKey ? {} : { error: "GitHub Copilot requires a stored OAuth/access token or GITHUB_COPILOT_TOKEN" }),
    }
  }
  if (id === "cloudflare-workers-ai") {
    const account = env.CLOUDFLARE_ACCOUNT_ID ?? metadata(context.credential, "accountId")
    const apiKey = token ?? env.CLOUDFLARE_API_KEY
    return {
      configured: Boolean(account && apiKey),
      options: {
        ...(account ? { baseURL: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1` } : {}),
        ...(apiKey ? { apiKey } : {}),
      },
      ...(!account || !apiKey ? { error: "Cloudflare Workers AI requires CLOUDFLARE_ACCOUNT_ID and a credential" } : {}),
    }
  }
  if (id === "cloudflare-ai-gateway") {
    const account = env.CLOUDFLARE_ACCOUNT_ID ?? metadata(context.credential, "accountId")
    const gateway = env.CLOUDFLARE_GATEWAY_ID ?? metadata(context.credential, "gatewayId")
    const apiKey = token ?? env.CLOUDFLARE_API_KEY
    return {
      configured: Boolean(account && gateway),
      options: {
        ...(account && gateway ? { baseURL: `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/compat` } : {}),
        ...(apiKey ? { apiKey } : {}),
      },
      ...(!account || !gateway ? { error: "Cloudflare AI Gateway requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_GATEWAY_ID" } : {}),
    }
  }
  if (id === "snowflake-cortex") {
    const account = env.SNOWFLAKE_ACCOUNT ?? metadata(context.credential, "account")
    const apiKey = token ?? env.SNOWFLAKE_TOKEN ?? env.SNOWFLAKE_PAT
    return {
      configured: Boolean(account && apiKey),
      options: {
        ...(account ? { baseURL: `https://${account}.snowflakecomputing.com/api/v2/cortex/v1` } : {}),
        ...(apiKey ? { apiKey } : {}),
      },
      ...(!account || !apiKey ? { error: "Snowflake Cortex requires SNOWFLAKE_ACCOUNT and a token credential" } : {}),
    }
  }
  if (id === "sap-ai-core" || (context.provider.api.type === "aisdk" && context.provider.api.package === "@jerome-benoit/sap-ai-provider-v2")) {
    const apiKey = token ?? env.AICORE_CLIENT_SECRET
    const baseURL = env.AICORE_BASE_URL ?? env.AICORE_SERVICE_URL ?? context.provider.api.url
    return {
      configured: Boolean(apiKey && baseURL),
      options: {
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
        ...(env.AICORE_RESOURCE_GROUP ? { resourceGroup: env.AICORE_RESOURCE_GROUP } : {}),
        ...(env.AICORE_DEPLOYMENT_ID ? { deploymentId: env.AICORE_DEPLOYMENT_ID } : {}),
      },
      ...(!apiKey || !baseURL ? { error: "SAP AI Core requires service URL and client-secret credential; inject its static provider loader explicitly" } : {}),
    }
  }
  return undefined
}

export function providerPackage(provider: Provider.Info) {
  return provider.api.type === "aisdk" ? provider.api.package : undefined
}
