import { afterEach, describe, expect, test } from "bun:test"
import { proxyRendererRequest } from "../src/transport/RendererProxy"

const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

describe("Renderer 开发代理", () => {
  test("拒绝把 Vite HMR WebSocket 当作普通 HTTP 转发", async () => {
    let upstreamCalls = 0
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        upstreamCalls += 1
        return new Response("unexpected")
      },
    })
    servers.push(upstream)

    const response = await proxyRendererRequest(new Request("http://127.0.0.1:9000/", {
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    }), `http://127.0.0.1:${upstream.port}`)

    expect(response.status).toBe(426)
    expect(upstreamCalls).toBe(0)
  })

  test("普通页面请求仍然转发到 Vite", async () => {
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("renderer-ready", { headers: { "Content-Type": "text/plain" } }),
    })
    servers.push(upstream)

    const response = await proxyRendererRequest(
      new Request("http://127.0.0.1:9000/demo?mode=dev"),
      `http://127.0.0.1:${upstream.port}`,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("renderer-ready")
  })
})
