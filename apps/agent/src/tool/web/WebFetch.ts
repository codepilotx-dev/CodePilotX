import { isIP } from "node:net"
import { lookup } from "node:dns/promises"
import { z } from "zod"
import { AgentError } from "../../domain"
import type { ToolDefinition } from "../ToolRegistry"

const DEFAULT_MAX_BYTES = 1_000_000
const DEFAULT_MAX_REDIRECTS = 5
const TEXT_MIME_TYPES = new Set(["application/json", "application/xml", "application/xhtml+xml", "application/ld+json"])

export type WebFetchResult = {
  url: string
  status: number
  mimeType: string
  title: string | null
  text: string
  bytes: number
  truncated: boolean
}

export type WebFetchDependencies = {
  fetch?: FetchLike
  resolve?: (hostname: string) => Promise<string[]>
  maxBytes?: number
  maxRedirects?: number
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const ipv4Number = (value: string) => value.split(".").reduce((total, part) => total * 256 + Number(part), 0) >>> 0
const inV4Range = (value: string, base: string, prefix: number) => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipv4Number(value) & mask) === (ipv4Number(base) & mask)
}

export const isPrivateNetworkAddress = (address: string): boolean => {
  const normalized = address.toLowerCase().split("%")[0]!
  if (isIP(normalized) === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([base, prefix]) => inV4Range(normalized, String(base), Number(prefix)))
  }
  if (isIP(normalized) === 6) {
    if (normalized === "::" || normalized === "::1") return true
    if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true
    if (normalized.startsWith("ff")) return true
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
    if (mapped) return isPrivateNetworkAddress(mapped)
    if (normalized.startsWith("2001:db8:")) return true
    // At present globally routable unicast IPv6 lives in 2000::/3. Treat all
    // other special/reserved ranges as non-public by default.
    return !/^[23]/.test(normalized)
  }
  return true
}

const defaultResolve = async (hostname: string) => {
  if (isIP(hostname)) return [hostname]
  return (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address)
}

export const validatePublicHttpUrl = async (raw: string, resolveHost: (hostname: string) => Promise<string[]> = defaultResolve) => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AgentError("WEB_FETCH_INVALID_URL", "WebFetch URL 无效", 400)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AgentError("WEB_FETCH_SCHEME_DENIED", "WebFetch 仅支持 HTTP/HTTPS", 400)
  if (url.username || url.password) throw new AgentError("WEB_FETCH_CREDENTIALS_DENIED", "WebFetch URL 不能包含凭据", 400)
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname)
  if (!addresses.length || addresses.some(isPrivateNetworkAddress)) throw new AgentError("WEB_FETCH_SSRF_DENIED", "WebFetch 禁止访问本机、私网或保留网络", 403)
  return url
}

const decodeEntities = (text: string) => text
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Number(value)))
  .replace(/&#x([\da-f]+);/gi, (_match, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))

export const extractReadableHtml = (html: string) => {
  const title = decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "") || null
  const preferred = html.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? html
  const text = decodeEntities(preferred
    .replace(/<(script|style|svg|canvas|noscript|template|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim())
  return { title, text }
}

const acceptedMimeType = (header: string | null) => {
  const mime = header?.split(";", 1)[0]?.trim().toLowerCase() || ""
  if (mime.startsWith("text/") || TEXT_MIME_TYPES.has(mime) || mime.endsWith("+json") || mime.endsWith("+xml")) return mime || "text/plain"
  throw new AgentError("WEB_FETCH_MIME_DENIED", `WebFetch 不支持 MIME 类型 ${mime || "unknown"}`, 415)
}

const readLimitedText = async (response: Response, maxBytes: number) => {
  const contentLength = Number(response.headers.get("content-length") ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new AgentError("WEB_FETCH_TOO_LARGE", `WebFetch 响应超过 ${maxBytes} 字节`, 413)
  if (!response.body) return { text: "", bytes: 0, truncated: false }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new AgentError("WEB_FETCH_TOO_LARGE", `WebFetch 响应超过 ${maxBytes} 字节`, 413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), bytes: total, truncated: false }
}

export const fetchWebDocument = async (rawUrl: string, dependencies: WebFetchDependencies = {}): Promise<WebFetchResult> => {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  const resolveHost = dependencies.resolve ?? defaultResolve
  const maxBytes = dependencies.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = dependencies.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  let url = await validatePublicHttpUrl(rawUrl, resolveHost)
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetchImpl(url, { redirect: "manual", headers: { accept: "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1", "user-agent": "CodePilotX-WebFetch/1" } })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) throw new AgentError("WEB_FETCH_REDIRECT_INVALID", "WebFetch 重定向缺少 Location", 502)
      if (redirect === maxRedirects) throw new AgentError("WEB_FETCH_TOO_MANY_REDIRECTS", "WebFetch 重定向次数过多", 508)
      url = await validatePublicHttpUrl(new URL(location, url).toString(), resolveHost)
      continue
    }
    if (!response.ok) throw new AgentError("WEB_FETCH_HTTP_ERROR", `WebFetch 上游返回 HTTP ${response.status}`, 502)
    const mimeType = acceptedMimeType(response.headers.get("content-type"))
    const body = await readLimitedText(response, maxBytes)
    const html = mimeType === "text/html" || mimeType === "application/xhtml+xml"
    const extracted = html ? extractReadableHtml(body.text) : { title: null, text: body.text.trim() }
    return { url: url.toString(), status: response.status, mimeType, title: extracted.title, text: extracted.text, bytes: body.bytes, truncated: body.truncated }
  }
  throw new AgentError("WEB_FETCH_TOO_MANY_REDIRECTS", "WebFetch 重定向次数过多", 508)
}

export const createWebFetchTool = (dependencies: WebFetchDependencies = {}): ToolDefinition<{ url: string }, WebFetchResult> => ({
  sdkName: "WebFetch",
  name: "web.fetch",
  description: "获取公开 HTTP/HTTPS 网页并提取正文；拒绝私网、非文本和过大响应。",
  schema: z.object({ url: z.string().url() }).strict(),
  inputSchema: { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"] },
  capabilities: { filesystem: "none", network: "declared", process: false, externalState: false, userInteraction: false },
  allowedModes: ["chat", "plan"],
  allowedProfiles: ["main", "default", "explorer", "worker"],
  approvalStrategy: "policy",
  visibility: "deferred",
  executionMode: "parallel",
  execute: (input, context) => {
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(15_000)])
    return fetchWebDocument(input.url, { ...dependencies, fetch: dependencies.fetch ? ((url, init) => dependencies.fetch!(url, { ...init, signal })) : ((url, init) => fetch(url, { ...init, signal })) })
  },
})
