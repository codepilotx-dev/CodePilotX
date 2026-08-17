/**
 * 测试用 Application runner fixture（自包含：不依赖 SDK 包，模拟跨语言 runner）。
 *
 * 通过 CPX_MODE 环境变量控制行为：
 * - 默认：完整实现 initialize/quiesce 握手；
 * - crash-immediately：启动即退出（crash 场景）；
 * - slow-init：不响应 initialize（触发 10s 握手超时）；
 * - ignore-quiesce：quiesce 永不响应（触发 shutdown 超时 + 进程树清理）；
 * - bad-protocol：输出非协议消息（触发协议错误路径）。
 */

import { createInterface } from "node:readline"

const pluginId = process.env.CPX_PLUGIN_ID ?? "acme.hello"
const generation = process.env.CPX_GENERATION ?? "g-1"
const mode = process.env.CPX_MODE ?? "normal"

const send = (message: unknown) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const respond = (request: Record<string, unknown>, result: unknown, error?: { code: string; message: string; retryable: boolean }) => {
  send({
    protocol: "cpx-plugin-rpc@1",
    version: 1,
    pluginId,
    generation,
    kind: "response",
    requestId: request.requestId,
    ...(error ? { error } : { result }),
  })
}

if (mode === "crash-immediately") {
  process.exit(2)
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on("line", (line) => {
  let message: Record<string, unknown>
  try {
    message = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }
  if (message.kind !== "request" || typeof message.method !== "string") return
  if (mode === "bad-protocol" && message.method === "plugin/initialize") {
    process.stdout.write("this is not a protocol message\n")
    return
  }
  if (mode === "slow-init" && message.method === "plugin/initialize") {
    return // 不响应 → 握手超时
  }
  if (message.method === "plugin/initialize") {
    const params = (message.params ?? {}) as { instanceToken?: unknown; manifest?: { id?: unknown } }
    const expectedToken = process.env.CPX_INSTANCE_TOKEN
    if (expectedToken && params.instanceToken !== expectedToken) {
      respond(message, undefined, { code: "AUTH_FAILED", message: "instance token mismatch", retryable: false })
      return
    }
    if (params.manifest?.id !== pluginId) {
      respond(message, undefined, { code: "AUTH_FAILED", message: "manifest id mismatch", retryable: false })
      return
    }
    respond(message, {
      capabilities: ["tools.v1"],
      config: {},
      dataDir: process.env.CPX_PLUGIN_DATA_DIR ?? "",
      generation,
      grantedPermissions: [],
    })
    return
  }
  if (message.method === "plugin/quiesce") {
    if (mode === "ignore-quiesce") return // 不响应 → shutdown 超时
    respond(message, undefined)
    return
  }
  if (message.method === "plugin/configChanged" || message.method === "plugin/shutdown") {
    respond(message, undefined)
    return
  }
  // full-stack 能力：工具/命令/视图/service 执行（默认模式提供）。
  if (message.method === "plugin/toolExecute") {
    respond(message, { echoed: (message.params ?? {}) as unknown })
    return
  }
  if (message.method === "plugin/commandExecute") {
    respond(message, { ok: true, command: (message.params as { command?: string } | undefined)?.command ?? "" })
    return
  }
  if (message.method === "plugin/viewRender") {
    respond(message, { nodes: [{ kind: "markdown", content: "hello from plugin" }] })
    return
  }
  if (message.method === "plugin/viewAction") {
    respond(message, { ok: true })
    return
  }
  if (message.method === "plugin/serviceCall") {
    respond(message, { handledBy: pluginId, method: (message.params as { method?: string } | undefined)?.method ?? "" })
    return
  }
  respond(message, undefined, { code: "UNKNOWN_METHOD", message: `未知方法：${String(message.method)}`, retryable: false })
})

// 保持进程存活直到 stdin 关闭。
process.stdin.resume()
process.stdin.on("end", () => {
  process.exit(0)
})
