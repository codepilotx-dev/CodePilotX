import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AgentError } from "../src/domain"
import { BraveSearchProvider, createBraveSearchTool, normalizeSearchDomains } from "../src/tool/web/SearchProvider"
import { extractReadableHtml, fetchWebDocument, isPrivateNetworkAddress, validatePublicHttpUrl } from "../src/tool/web/WebFetch"

const publicDns = async () => ["93.184.216.34"]

describe("WebFetch", () => {
  test("拒绝本机、私网、保留地址及非 HTTP URL", async () => {
    expect(isPrivateNetworkAddress("127.0.0.1")).toBe(true)
    expect(isPrivateNetworkAddress("10.1.2.3")).toBe(true)
    expect(isPrivateNetworkAddress("::1")).toBe(true)
    expect(isPrivateNetworkAddress("2001:db8::1")).toBe(true)
    expect(isPrivateNetworkAddress("93.184.216.34")).toBe(false)
    await expect(validatePublicHttpUrl("http://internal.test", async () => ["192.168.1.8"])).rejects.toMatchObject({ code: "WEB_FETCH_SSRF_DENIED" })
    await expect(validatePublicHttpUrl("file:///etc/passwd", publicDns)).rejects.toMatchObject({ code: "WEB_FETCH_SCHEME_DENIED" })
    await expect(validatePublicHttpUrl("http://[::1]/", publicDns)).rejects.toMatchObject({ code: "WEB_FETCH_SSRF_DENIED" })
  })

  test("逐跳验证重定向目标，阻止重定向到私网", async () => {
    const fetchMock = async () => new Response(null, { status: 302, headers: { location: "http://private.test/admin" } })
    await expect(fetchWebDocument("https://public.test", {
      fetch: fetchMock,
      resolve: async (host) => host === "private.test" ? ["127.0.0.1"] : publicDns(),
    })).rejects.toMatchObject({ code: "WEB_FETCH_SSRF_DENIED" })
  })

  test("拒绝非文本和超限响应并提取正文", async () => {
    await expect(fetchWebDocument("https://public.test/image", {
      fetch: async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }),
      resolve: publicDns,
    })).rejects.toMatchObject({ code: "WEB_FETCH_MIME_DENIED" })

    await expect(fetchWebDocument("https://public.test/large", {
      fetch: async () => new Response("too large", { headers: { "content-type": "text/plain", "content-length": "100" } }),
      resolve: publicDns,
      maxBytes: 8,
    })).rejects.toMatchObject({ code: "WEB_FETCH_TOO_LARGE" })

    const result = extractReadableHtml("<title>A &amp; B</title><nav>menu</nav><main><h1>Hello</h1><p>Useful text</p><script>secret()</script></main>")
    expect(result).toEqual({ title: "A & B", text: "Hello\nUseful text" })
  })
})

describe("BraveSearchProvider", () => {
  test("只从凭据仓库取密钥并归一化结果", async () => {
    const secret = ["memory", "only", "credential"].join("-")
    let requestedIntegration = ""
    let receivedHeader = ""
    const credentials = {
      get(integrationID: string) {
        requestedIntegration = integrationID
        return Effect.succeed({ id: "test", integrationID, methodID: null, label: "test", value: { apiKey: secret } })
      },
    }
    const provider = new BraveSearchProvider({
      credentials: credentials as never,
      fetch: (async (_url, init) => {
        receivedHeader = new Headers(init?.headers).get("x-subscription-token") ?? ""
        return Response.json({ web: { results: [{ title: "Result", url: "https://example.com", description: "Summary" }] } })
      }),
    })
    const response = await provider.search({ query: "code" }, new AbortController().signal)
    expect(requestedIntegration).toBe("brave-search")
    expect(receivedHeader).toBe(secret)
    expect(response.results).toEqual([{ title: "Result", url: "https://example.com", snippet: "Summary" }])
  })

  test("缺少凭据时不发起网络请求", async () => {
    let fetched = false
    const provider = new BraveSearchProvider({
      credentials: { get: () => Effect.succeed(null) } as never,
      fetch: async () => { fetched = true; return Response.json({}) },
    })
    try {
      await provider.search({ query: "code" }, new AbortController().signal)
      throw new Error("expected failure")
    } catch (cause) {
      expect(cause).toBeInstanceOf(AgentError)
      expect((cause as AgentError).code).toBe("SEARCH_CREDENTIAL_MISSING")
    }
    expect(fetched).toBe(false)
  })

  test("校验允许/阻止域名并按规范化 hostname 过滤", async () => {
    expect(() => normalizeSearchDomains({ allowed_domains: ["Example.com."], blocked_domains: ["example.com"] })).toThrow()
    expect(() => normalizeSearchDomains({ allowed_domains: ["https://example.com/path"] })).toThrow()
    const credentials = { get: () => Effect.succeed({ value: { apiKey: ["runtime", "secret"].join("-") } }) }
    const provider = new BraveSearchProvider({
      credentials: credentials as never,
      fetch: async () => Response.json({ web: { results: [
        { title: "Allowed", url: "https://DOCS.Example.com/page", description: "yes" },
        { title: "Blocked", url: "https://private.example.com", description: "no" },
        { title: "Other", url: "https://other.test", description: "no" },
      ] } }),
    })
    const result = await provider.search({ query: "code", allowed_domains: ["example.com"], blocked_domains: ["private.example.com"] }, new AbortController().signal)
    expect(result.results.map((item) => item.title)).toEqual(["Allowed"])
    expect(createBraveSearchTool({ credentials: credentials as never }).sdkName).toBe("WebSearch")
  })
})
