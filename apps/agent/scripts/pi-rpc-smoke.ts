import { Effect } from "effect"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai"
import { Capabilities, decodeEventEnvelope } from "@codepilotx/agent-protocol"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createBootstrap } from "../src/bootstrap"

const dataDir = await mkdtemp(join(tmpdir(), "codepilotx-pi-rpc-"))
const priorDataDir = process.env.CODEPILOTX_DATA_DIR
const priorDesktopManaged = process.env.CODEPILOTX_DESKTOP_MANAGED
process.env.CODEPILOTX_DATA_DIR = dataDir
process.env.CODEPILOTX_DESKTOP_MANAGED = "1"

const faux = fauxProvider({ provider: "codepilotx-pi-smoke" })
faux.setResponses([fauxAssistantMessage(fauxText("Pi RPC smoke completed."))])
const models = createModels()
models.setProvider(faux.provider)
const model = faux.getModel()

let runtime: Awaited<ReturnType<typeof Effect.runPromise<ReturnType<typeof createBootstrap>>>> | undefined
try {
  runtime = await Effect.runPromise(createBootstrap({
    models,
    initializeDatabase: (db) => db.setSetting("defaultModel", { providerID: model.provider, id: model.id }),
  }))
  let id = 0
  let connectionId = ""
  const call = async (method: string, params: Record<string, unknown>) => {
    const response = await runtime!.app.request("http://agent.local/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", ...(connectionId ? { "x-codepilotx-connection-id": connectionId } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: `smoke:${++id}`, method, params }),
    })
    const payload = await response.json() as any
    if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`)
    return payload.result
  }
  const initialized = await call("initialize", {
    clientInfo: { name: "pi-rpc-smoke", version: "1.0.0", platform: "win32" },
    protocols: ["thread-rpc-v4"], capabilities: [...Capabilities], interactionDelivery: "active",
  })
  connectionId = initialized.connectionId
  await runtime.app.request("http://agent.local/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", "x-codepilotx-connection-id": connectionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: { protocol: "thread-rpc-v4" } }),
  })
  const providers = (await call("provider/list", {})).providers as Array<{ id: string; integrationID?: string }>
  const integrations = (await call("integration/list", {})).integrations as Array<{ id: string; methods: Array<{ type: string }> }>
  const smokeProvider = providers.find((provider) => provider.id === model.provider)
  const smokeIntegration = integrations.find((integration) => integration.id === smokeProvider?.integrationID)
  if (!smokeProvider || !smokeIntegration || !smokeIntegration.methods.some((method) => method.type === "key")) {
    throw new Error(`Pi provider/integration catalog mismatch: provider=${JSON.stringify(smokeProvider)}, integration=${JSON.stringify(smokeIntegration)}`)
  }
  const project = (await call("project/open", { rootPath: resolve(import.meta.dir, "../../.."), operationId: crypto.randomUUID() })).project
  const created = await call("thread/create", {
    workspace: { kind: "project", projectId: project.id },
    operationId: crypto.randomUUID(),
  })
  const threadId = created.snapshot.thread.id
  const subscription = await call("event/subscribe", { streams: [{ streamId: threadId, after: "latest" }] })
  let sawDelta = false
  let sawTerminal = false
  const strictPiEvents = new Set([
    "item/agentMessage/delta",
    "reasoning/textDelta",
    "tool/outputDelta",
    "context/compacted",
  ])
  const readSse = (async () => {
    const response = await runtime!.app.request(`http://agent.local/rpc/events?subscriptionId=${encodeURIComponent(subscription.subscriptionId)}&connectionId=${encodeURIComponent(connectionId)}`)
    if (!response.ok || !response.body) throw new Error(`SSE failed: ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ""
    while (!sawTerminal) {
      const next = await reader.read()
      if (next.done) break
      buffered += decoder.decode(next.value, { stream: true })
      const frames = buffered.split("\n\n")
      buffered = frames.pop() ?? ""
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim()
        if (!data) continue
        const message = JSON.parse(data) as { method?: string; params?: { event?: unknown } }
        const rawEnvelope = message.method === "event/next" && message.params?.event && typeof message.params.event === "object"
          ? message.params.event as { type?: string }
          : null
        const envelope = rawEnvelope?.type && strictPiEvents.has(rawEnvelope.type)
          ? decodeEventEnvelope(rawEnvelope)
          : null
        const type = envelope?.type ?? rawEnvelope?.type
        if (type === "item/agentMessage/delta") sawDelta = true
        if (type === "turn/completed") sawTerminal = true
      }
    }
  })()
  const turn = await call("turn/start", {
    threadId, inputId: crypto.randomUUID(), content: "Reply with the smoke confirmation.",
    model: { providerID: model.provider, id: model.id }, permissionConfig: DEFAULT_PERMISSION_CONFIG, taskMode: "chat",
  })

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && !sawTerminal) {
    if (!sawTerminal) await Bun.sleep(20)
  }
  await call("event/unsubscribe", { subscriptionId: subscription.subscriptionId })
  await readSse
  if (!sawDelta || !sawTerminal) {
    const state = runtime.db.sqlite.query("SELECT id, status, started_at, finished_at FROM turns WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1").get(threadId)
    const events = runtime.db.sqlite.query("SELECT method, params FROM events WHERE thread_id = ? ORDER BY id").all(threadId)
    throw new Error(`RPC smoke timed out: delta=${sawDelta}, terminal=${sawTerminal}, turn=${JSON.stringify(state)}, events=${JSON.stringify(events)}`)
  }
  await call("shutdown", { operationId: crypto.randomUUID() })
  process.stdout.write("Pi RPC/SSE contract smoke passed\n")
} finally {
  await runtime?.dispose()
  runtime?.db.close()
  if (priorDataDir === undefined) delete process.env.CODEPILOTX_DATA_DIR
  else process.env.CODEPILOTX_DATA_DIR = priorDataDir
  if (priorDesktopManaged === undefined) delete process.env.CODEPILOTX_DESKTOP_MANAGED
  else process.env.CODEPILOTX_DESKTOP_MANAGED = priorDesktopManaged
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
}
