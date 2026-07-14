import { Effect } from "effect"
import { resolve } from "node:path"
import { bootstrap } from "./bootstrap"
import { AgentLogger } from "./observability/AgentLogger"

const fallbackLogger = new AgentLogger(resolve(process.env.CODEPILOTX_LOG_DIR ?? resolve(process.env.CODEPILOTX_DATA_DIR ?? "./.codepilotx", "logs")))
const runtime = await Effect.runPromise(bootstrap).catch((cause) => {
  fallbackLogger.error("agent.startup-failed", { error: cause instanceof Error ? cause.message : String(cause) })
  throw cause
})
const server = Bun.serve({
  hostname: runtime.config.host,
  port: runtime.config.port,
  fetch: runtime.app.fetch,
  idleTimeout: 120,
})

const url = `http://${server.hostname}:${server.port}`
runtime.logger.info("agent.started", { host: server.hostname, port: server.port, pid: process.pid })
process.stdout.write(`${JSON.stringify({ type: "ready", port: server.port, url })}\n`)

let closing = false
const shutdown = async (exitCode = 0) => {
  if (closing) return
  closing = true
  runtime.logger.info("agent.stopping", { exitCode })
  await server.stop(true)
  await runtime.providers.dispose()
  runtime.db.close()
  process.exit(exitCode)
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
process.once("uncaughtException", (cause) => {
  runtime.logger.error("process.uncaught-exception", { error: cause instanceof Error ? cause.message : String(cause), stack: cause instanceof Error ? cause.stack : undefined })
  void shutdown(1)
})
process.once("unhandledRejection", (cause) => {
  runtime.logger.error("process.unhandled-rejection", { error: cause instanceof Error ? cause.message : String(cause), stack: cause instanceof Error ? cause.stack : undefined })
  void shutdown(1)
})
