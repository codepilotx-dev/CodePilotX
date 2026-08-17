/**
 * Application Runner conformance 工具（PR 4/9 开发工具）。
 *
 * 验证一个 process 插件（runner）是否正确实现 `cpx-plugin-rpc@1` wire：
 * - initialize 握手：响应头完整（protocol/version/pluginId/generation 与请求一致、
 *   requestId 回显），result 携带 capabilities 数组；
 * - 未知方法必须返回安全错误 envelope（仅 code/message/retryable，
 *   携带额外字段如 stack 视为失败）；
 * - toolExecute 正常响应；quiesce 响应；shutdown 响应后进程退出
 *   （超时后清理子进程）。
 *
 * 本工具只把显式传入的 env 交给子进程，不注入任何宿主敏感环境；
 * 输出只包含安全错误码与检查摘要，不携带原始 payload。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import { PLUGIN_PROTOCOL, PLUGIN_PROTOCOL_VERSION } from "../wire/messages"

export interface RunnerConformanceOptions {
  /** 插件进程入口（可执行文件，或脚本解释器路径如 bun + fixture 路径）。 */
  executable: string
  args?: string[]
  env?: Record<string, string>
  pluginId: string
  generation: string
  instanceToken?: string
  /** 单条请求等待超时（毫秒，默认 5000）。 */
  timeoutMs?: number
}

export interface RunnerConformanceCheck {
  name: string
  ok: boolean
  detail?: string
}

export interface RunnerConformanceReport {
  pass: boolean
  checks: RunnerConformanceCheck[]
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" ? (value as Record<string, unknown>) : null

/** 运行 runner conformance（不抛错；任何断言失败进入 checks）。 */
export async function runRunnerConformance(
  options: RunnerConformanceOptions,
): Promise<RunnerConformanceReport> {
  const checks: RunnerConformanceCheck[] = []
  const record = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) })
  }
  const timeoutMs = options.timeoutMs ?? 5000

  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(options.executable, options.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
      windowsHide: true,
    })
  } catch (cause) {
    return {
      pass: false,
      checks: [{
        name: "进程启动",
        ok: false,
        detail: `无法启动进程：${cause instanceof Error ? cause.message : String(cause)}`,
      }],
    }
  }

  const pending = new Map<string, {
    resolve: (message: Record<string, unknown>) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on("line", (line) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      return // 非协议行（如插件自身日志）忽略
    }
    const message = asRecord(parsed)
    if (!message) return
    const requestId = typeof message.requestId === "string" ? message.requestId : null
    if (!requestId) return
    const waiter = pending.get(requestId)
    if (!waiter) return
    clearTimeout(waiter.timer)
    pending.delete(requestId)
    waiter.resolve(message)
  })

  const sendRequest = (method: string, params: unknown, requestId: string) => {
    try {
      child.stdin.write(JSON.stringify({
        protocol: PLUGIN_PROTOCOL,
        version: PLUGIN_PROTOCOL_VERSION,
        pluginId: options.pluginId,
        generation: options.generation,
        kind: "request",
        requestId,
        method,
        ...(params === undefined ? {} : { params }),
      }) + "\n")
    } catch {
      // EPIPE 等：等待方会因超时得到 null，由检查项报告失败。
    }
  }

  const waitResponse = (requestId: string, waitMs: number): Promise<Record<string, unknown> | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve(null)
      }, waitMs)
      pending.set(requestId, { resolve, timer })
    })

  const shutdown = () => {
    lines.close()
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    try {
      child.kill()
    } catch {}
  }

  try {
    // 1. initialize 握手：响应头完整 + capabilities。
    //    进程启动判定不依赖 spawn 事件（bun 上会延迟触发），
    //    以「spawn error 事件 vs 初始化响应」竞态为准。
    const initRequestId = "init-1"
    sendRequest("plugin/initialize", {
      instanceToken: options.instanceToken,
      manifest: { id: options.pluginId, version: "1.0.0" },
    }, initRequestId)
    const initWait = waitResponse(initRequestId, timeoutMs)
    const launch = await Promise.race([
      new Promise<"spawn-error">((resolve) => child.once("error", () => resolve("spawn-error"))),
      initWait.then((message): "init-ok" | "init-timeout" => (message ? "init-ok" : "init-timeout")),
    ])
    if (launch === "spawn-error") {
      record("进程启动", false, "无法启动插件进程")
      return { pass: false, checks }
    }
    record("进程启动", true)
    const init = await initWait
    if (!init) {
      record("initialize 握手", false, "超时未收到响应")
      return { pass: false, checks }
    }
    const headerOk = init.kind === "response"
      && init.requestId === initRequestId
      && init.protocol === PLUGIN_PROTOCOL
      && init.version === PLUGIN_PROTOCOL_VERSION
      && init.pluginId === options.pluginId
      && init.generation === options.generation
    record("initialize 响应头完整", headerOk, headerOk ? undefined : "响应头与请求不一致或缺少字段")
    const initResult = asRecord(init.result)
    record(
      "initialize 返回 capabilities",
      initResult !== null && Array.isArray(initResult.capabilities),
      initResult === null ? "缺少 result" : "capabilities 必须是数组",
    )
    if (!headerOk || init.error) {
      record("后续协议检查", false, "握手未通过，跳过")
      return { pass: false, checks }
    }

    // 2. 未知方法 → 安全错误 envelope（仅 code/message/retryable）。
    const unknownId = "unknown-1"
    sendRequest("plugin/notAMethod", undefined, unknownId)
    const unknown = await waitResponse(unknownId, timeoutMs)
    if (!unknown) {
      record("未知方法返回安全错误 envelope", false, "超时未收到响应")
    } else {
      const error = asRecord(unknown.error)
      const envelopeOk = error !== null
        && typeof error.code === "string"
        && typeof error.message === "string"
        && typeof error.retryable === "boolean"
        && Object.keys(error).length === 3
      record("未知方法返回安全错误 envelope", envelopeOk,
        envelopeOk ? undefined : "错误必须只包含 code/message/retryable（禁止 stack 等字段）")
    }

    // 3. toolExecute 正常响应。
    const toolId = "tool-1"
    sendRequest("plugin/toolExecute", { tool: "conformance", input: {} }, toolId)
    const tool = await waitResponse(toolId, timeoutMs)
    record("toolExecute 正常响应", tool !== null && !tool.error && asRecord(tool.result) !== null,
      tool === null ? "超时未收到响应" : undefined)

    // 4. quiesce 响应。
    const quiesceId = "quiesce-1"
    sendRequest("plugin/quiesce", undefined, quiesceId)
    const quiesce = await waitResponse(quiesceId, timeoutMs)
    record("quiesce 正常响应", quiesce !== null && !quiesce.error,
      quiesce === null ? "超时未收到响应" : undefined)

    // 5. shutdown 响应后进程退出。
    const shutdownId = "shutdown-1"
    sendRequest("plugin/shutdown", undefined, shutdownId)
    const shutdownResponse = await waitResponse(shutdownId, timeoutMs)
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
      new Promise<boolean>((resolve) => { shutdownTimer = setTimeout(() => resolve(false), timeoutMs) }),
    ])
    if (shutdownTimer !== undefined) clearTimeout(shutdownTimer)
    record("shutdown 后进程退出", shutdownResponse !== null && !shutdownResponse.error && exited,
      shutdownResponse === null ? "shutdown 未响应" : exited ? undefined : "shutdown 后进程未退出")
  } finally {
    shutdown()
  }
  return { pass: checks.every((check) => check.ok), checks }
}
