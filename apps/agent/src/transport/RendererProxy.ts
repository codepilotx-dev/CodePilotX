const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const

const sanitizedHeaders = (source: Headers) => {
  const headers = new Headers(source)
  headers.delete("host")
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name)
  return headers
}

export const proxyRendererRequest = async (request: Request, rendererDevURL: string) => {
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return new Response("Vite HMR WebSocket 必须直连 Renderer 开发服务", {
      status: 426,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-CodePilotX-Renderer-Proxy": "websocket-direct-only",
        Connection: "close",
      },
    })
  }

  const source = new URL(request.url)
  const target = new URL(source.pathname + source.search, rendererDevURL)
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: sanitizedHeaders(request.headers),
      ...(["GET", "HEAD"].includes(request.method) ? {} : { body: request.body }),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return new Response("Renderer 开发服务暂不可用", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-CodePilotX-Renderer-Proxy": "upstream-unavailable",
      },
    })
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: sanitizedHeaders(upstream.headers),
  })
}
