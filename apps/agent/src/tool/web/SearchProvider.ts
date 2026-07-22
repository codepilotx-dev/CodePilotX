import { Effect } from "effect"
import { z } from "zod"
import { isIP } from "node:net"
import type { EncryptedCredentialRepository } from "../../auth/EncryptedCredentialRepository"
import { AgentError } from "../../domain"
import type { ToolDefinition } from "../ToolRegistry"
import type { FetchLike } from "./WebFetch"

export type SearchQuery = { query: string; allowed_domains?: string[] | undefined; blocked_domains?: string[] | undefined }
export type SearchResult = { title: string; url: string; snippet: string; publishedAt?: string }
export type SearchResponse = { provider: string; query: string; results: SearchResult[] }

export interface SearchProvider {
  readonly id: string
  search(input: SearchQuery, signal: AbortSignal): Promise<SearchResponse>
}

export class SearchProviderCatalog {
  private readonly providers = new Map<string, SearchProvider>()
  register(provider: SearchProvider) {
    if (this.providers.has(provider.id)) throw new AgentError("SEARCH_PROVIDER_DUPLICATE", `搜索 Provider ${provider.id} 已注册`, 409)
    this.providers.set(provider.id, provider)
    return this
  }
  get(id: string) {
    const provider = this.providers.get(id)
    if (!provider) throw new AgentError("SEARCH_PROVIDER_NOT_FOUND", `搜索 Provider ${id} 不存在`, 404)
    return provider
  }
  list() { return [...this.providers.keys()] }
}

export type BraveSearchDependencies = {
  credentials: EncryptedCredentialRepository
  fetch?: FetchLike
  integrationID?: string
  endpoint?: string
}

const credentialApiKey = (value: unknown) => {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  for (const key of ["apiKey", "api_key", "token", "key"]) if (typeof record[key] === "string" && record[key]) return record[key] as string
  return null
}

const normalizeDomain = (value: string) => {
  const candidate = value.trim().toLowerCase().replace(/\.$/, "")
  if (!candidate || candidate.includes(":")) throw new AgentError("SEARCH_DOMAIN_INVALID", `无效搜索域名 ${value}`, 400)
  let url: URL
  try { url = new URL(`https://${candidate}`) } catch { throw new AgentError("SEARCH_DOMAIN_INVALID", `无效搜索域名 ${value}`, 400) }
  const validLabels = url.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  if (url.hostname !== candidate || url.pathname !== "/" || url.search || url.hash || !url.hostname.includes(".") || isIP(url.hostname) !== 0 || !validLabels) {
    throw new AgentError("SEARCH_DOMAIN_INVALID", `无效搜索域名 ${value}`, 400)
  }
  return url.hostname
}

const domainContains = (parent: string, child: string) => child === parent || child.endsWith(`.${parent}`)

export const normalizeSearchDomains = (input: Pick<SearchQuery, "allowed_domains" | "blocked_domains">) => {
  const allowedDomains = [...new Set((input.allowed_domains ?? []).map(normalizeDomain))]
  const blockedDomains = [...new Set((input.blocked_domains ?? []).map(normalizeDomain))]
  const conflict = allowedDomains.find((allowed) => blockedDomains.includes(allowed))
  if (conflict) throw new AgentError("SEARCH_DOMAIN_CONFLICT", `搜索域名同时被允许和阻止：${conflict}`, 400)
  return { allowedDomains, blockedDomains }
}

const resultHostname = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname.toLowerCase().replace(/\.$/, "") : null
  } catch { return null }
}

export class BraveSearchProvider implements SearchProvider {
  readonly id = "brave"
  private readonly fetchImpl: FetchLike
  private readonly integrationID: string
  private readonly endpoint: string
  constructor(private readonly dependencies: BraveSearchDependencies) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch
    this.integrationID = dependencies.integrationID ?? "brave-search"
    this.endpoint = dependencies.endpoint ?? "https://api.search.brave.com/res/v1/web/search"
  }

  async search(input: SearchQuery, signal: AbortSignal): Promise<SearchResponse> {
    const domains = normalizeSearchDomains(input)
    const credential = await Effect.runPromise(this.dependencies.credentials.get<unknown>(this.integrationID))
    const apiKey = credentialApiKey(credential?.value)
    if (!apiKey) throw new AgentError("SEARCH_CREDENTIAL_MISSING", "Brave Search 凭据未配置", 401)
    const url = new URL(this.endpoint)
    url.searchParams.set("q", input.query)
    url.searchParams.set("count", "20")
    const response = await this.fetchImpl(url, { signal, headers: { accept: "application/json", "x-subscription-token": apiKey } })
    if (!response.ok) throw new AgentError("SEARCH_PROVIDER_ERROR", `Brave Search 返回 HTTP ${response.status}`, 502)
    const payload = await response.json() as { web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown; page_age?: unknown }> } }
    const results = (payload.web?.results ?? []).flatMap((item) => {
      if (typeof item.title !== "string" || typeof item.url !== "string") return []
      const hostname = resultHostname(item.url)
      if (!hostname) return []
      if (domains.allowedDomains.length && !domains.allowedDomains.some((domain) => domainContains(domain, hostname))) return []
      if (domains.blockedDomains.some((domain) => domainContains(domain, hostname))) return []
      return [{ title: item.title, url: item.url, snippet: typeof item.description === "string" ? item.description : "", ...(typeof item.page_age === "string" ? { publishedAt: item.page_age } : {}) }]
    })
    return { provider: this.id, query: input.query, results }
  }
}

const searchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  allowed_domains: z.array(z.string()).max(50).optional(),
  blocked_domains: z.array(z.string()).max(50).optional(),
}).strict().superRefine((input, context) => {
  try { normalizeSearchDomains(input) } catch (cause) { context.addIssue({ code: "custom", message: cause instanceof Error ? cause.message : "搜索域名无效" }) }
})

export const createWebSearchTool = (provider: SearchProvider): ToolDefinition<z.infer<typeof searchSchema>, SearchResponse> => ({
  sdkName: "WebSearch",
  name: "web.search",
  description: `通过 ${provider.id} 搜索公开网页，返回标题、URL 和摘要。`,
  schema: searchSchema,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 500 },
      allowed_domains: { type: "array", items: { type: "string" }, maxItems: 50 },
      blocked_domains: { type: "array", items: { type: "string" }, maxItems: 50 },
    },
    required: ["query"],
  },
  capabilities: { filesystem: "none", network: "declared", process: false, externalState: false, userInteraction: false },
  allowedModes: ["chat", "plan"],
  allowedProfiles: ["main", "default", "explorer", "worker"],
  approvalStrategy: "policy",
  visibility: "deferred",
  executionMode: "parallel",
  execute: (input, context) => provider.search(input, context.signal),
})

export const createBraveSearchTool = (dependencies: BraveSearchDependencies) => createWebSearchTool(new BraveSearchProvider(dependencies))
