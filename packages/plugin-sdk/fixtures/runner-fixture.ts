/**
 * Runner conformance 测试用自包含 fixture：不依赖 SDK 包，模拟跨语言 runner。
 *
 * 通过 CPX_MODE 环境变量控制行为：
 * - normal：完整实现 initialize/quiesce/shutdown 握手与工具执行；
 * - slow-init：initialize 永不响应（触发握手超时）；
 * - missing-header：响应缺少 protocol/version 头（触发响应头检查失败）；
 * - leak-stack：未知方法错误携带 stack 字段（触发安全 envelope 检查失败）。
 */

import { createInterface } from "node:readline"

const pluginId = process.env.CPX_PLUGIN_ID ?? "acme.hello"
const generation = process.env.CPX_GENERATION ?? "g-1"
const mode = process.env.CPX_MODE ?? "normal"

const send = (message: unknown) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const respond = (
  request: Record<string, unknown>,
  result: unknown,
  error?: { code: string; message: string; retryable: boolean } & Record<string, unknown>,
) => {
  const header = mode === "missing-header"
    ? {}
    : { protocol: "cpx-plugin-rpc@1", version: 1, pluginId, generation }
  send({
    ...header,
    kind: "response",
    requestId: request.requestId,
    ...(error ? { error } : { result }),
  })
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
  if (message.method === "plugin/initialize") {
    if (mode === "slow-init") return // 不响应 → 握手超时
    const params = (message.params ?? {}) as { instanceToken?: unknown }
    const expected = process.env.CPX_INSTANCE_TOKEN
    if (expected && params.instanceToken !== expected) {
      respond(message, undefined, { code: "AUTH_FAILED", message: "instance token mismatch", retryable: false })
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
    respond(message, undefined)
    return
  }
  if (message.method === "plugin/shutdown") {
    respond(message, undefined)
    process.exit(0)
    return
  }
  if (message.method === "plugin/toolExecute") {
    respond(message, { ok: true })
    return
  }
  const leaked = mode === "leak-stack" ? { stack: new Error("boom").stack } : {}
  respond(message, undefined, { code: "UNKNOWN_METHOD", message: "未知方法", retryable: false, ...leaked })
})

process.stdin.resume()
process.stdin.on("end", () => {
  process.exit(0)
})
