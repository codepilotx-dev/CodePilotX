import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { AgentDatabase } from "../src/storage/Database"
import { ModelCatalog } from "../src/provider/ModelCatalog"

const paths: string[] = []
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("模型目录合并", () => {
  test("接受 shared ProviderSetting 的 OpenAI-Compatible 模型", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-catalog-"))
    paths.push(root)
    const snapshot = join(root, "models.snapshot.json")
    await Bun.write(snapshot, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), providers: [] }))
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    db.setProviderSettings("minimax", {
      providerID: "minimax",
      name: "MiniMax",
      kind: "openai-compatible",
      baseURL: "https://api.example.test/v1",
      models: [{
        id: "MiniMax-M2",
        name: "MiniMax M2",
        api: "openai-chat-completions",
        limits: { context: 204_800, output: 16_384 },
        capabilities: { reasoning: true, toolCall: true, imageInput: false },
      }],
    })
    const catalog = new ModelCatalog({
      host: "127.0.0.1", port: 0, authToken: null, dataDir: root, logDir: join(root, "logs"), databasePath: join(root, "agent.sqlite"), modelSnapshotPath: snapshot,
      modelCachePath: join(root, "models.cache.json"), rendererDir: null, rendererDevURL: null, modelsDevURL: "https://models.dev/api.json",
    }, db, async () => false)
    await Effect.runPromise(catalog.load())
    const model = catalog.getModel("minimax", "MiniMax-M2")
    expect(model.protocol).toBe("openai-compatible")
    expect(model.capabilities.tools).toBeTrue()
    expect(model.capabilities.inputLimit).toBe(204_800)
    db.close()
  })
})
