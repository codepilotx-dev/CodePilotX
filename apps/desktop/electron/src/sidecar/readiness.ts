import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { DesktopLogger } from "../logging/desktop-logger.js"

const READY_TIMEOUT_MS = 60_000
const HEALTH_TIMEOUT_MS = 20_000

interface ReadyMessage {
  readonly type: "ready"
  readonly port: number
  readonly host?: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function waitForReadyMessage(
  child: ChildProcessWithoutNullStreams,
  logger: DesktopLogger,
): Promise<ReadyMessage> {
  return new Promise((resolveReady, rejectReady) => {
    let buffer = ""
    let ready = false
    const timer = setTimeout(
      () => finishBeforeReady(new Error("等待 Agent ready 消息超时")),
      READY_TIMEOUT_MS,
    )

    const finishBeforeReady = (result: Error): void => {
      clearTimeout(timer)
      child.stdout.removeListener("data", onData)
      child.removeListener("error", onError)
      child.removeListener("exit", onEarlyExit)
      rejectReady(result)
    }
    const finishReady = (result: ReadyMessage): void => {
      clearTimeout(timer)
      ready = true
      child.removeListener("error", onError)
      child.removeListener("exit", onEarlyExit)
      resolveReady(result)
    }
    const onError = (error: Error): void => finishBeforeReady(error)
    const onEarlyExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => finishBeforeReady(
      new Error(
        `Agent 在 ready 前退出（code=${String(code)}, signal=${String(signal)}）`,
      ),
    )
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8")
      for (;;) {
        const newline = buffer.indexOf("\n")
        if (newline < 0) return
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as Partial<ReadyMessage>
          if (
            parsed.type === "ready"
            && Number.isInteger(parsed.port)
            && Number(parsed.port) > 0
          ) {
            if (!ready) {
              finishReady({
                type: "ready",
                port: Number(parsed.port),
                host: parsed.host,
              })
            }
            return
          }
          logger.forwardConsoleLine(line)
        } catch {
          logger.forwardConsoleLine(line)
        }
      }
    }

    child.stdout.on("data", onData)
    child.once("error", onError)
    child.once("exit", onEarlyExit)
  })
}

export async function waitForReady(
  origin: string,
  token: string,
  logger: DesktopLogger,
  attempt: number,
): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastError: unknown
  let probeCount = 0
  while (Date.now() < deadline) {
    probeCount += 1
    try {
      await probeReady(origin, fetch, token, 1_500)
      logger.info("sidecar.ready-probe-ok", { origin, attempt })
      return
    } catch (error) {
      lastError = error
      if (probeCount === 1 || probeCount % 10 === 0) {
        logger.warn("sidecar.ready-probe-error", {
          origin,
          attempt,
          probeCount,
          message: formatError(error),
        })
      }
    }
    await sleep(200)
  }
  throw new Error(`Agent 就绪检查超时：${formatError(lastError)}`)
}

export async function probeReady(
  origin: string,
  fetcher: FetchLike,
  token: string | undefined,
  timeoutMs: number,
): Promise<void> {
  const response = await fetcher(`${origin}/api/ready`, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json() as { ok?: boolean }
  if (body.ok !== true) throw new Error("Agent ready 返回无效")
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "未知错误")
}
