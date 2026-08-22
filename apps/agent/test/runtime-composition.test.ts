import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Model, Provider } from "@codepilotx/model-schema"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { RuntimeCompositionService } from "../src/runtime-composition/service"
import type { RuntimeCompositionSnapshotV1 } from "../src/runtime-composition/types"
import { removeFixturePaths } from "./fixture-cleanup"

const paths: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
})

const snapshot = (turnID: string): RuntimeCompositionSnapshotV1 => ({
  version: 1,
  identity: { id: `rc:${turnID}`, version: 1, hash: `overall:${turnID}` },
  model: { providerID: "openai", id: "test", variant: null, contextWindow: 128_000, capabilities: { tools: true, input: ["text"], output: ["text"] } },
  workspace: { kind: "project", cwd: "C:/workspace", roots: ["C:/workspace"], outputDirectory: null, instructionSources: [] },
  permissions: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
  skills: { skills: [] },
  mcp: { workspaceKey: "C:/workspace", bindingHash: "mcp", serverInstructions: [] },
  tools: { eager: ["Read"], deferred: [], exposed: ["Read"] },
  prompt: {
    instructions: "frozen prompt",
    stableContextText: "frozen prompt",
    baseHash: "base",
    contextHash: "context",
    cacheHash: "cache-hash",
    cacheKey: "cache",
    diagnostics: [],
    contextItems: [],
    cacheSegments: [],
    cacheBoundaries: [],
  },
  context: { threadsActiveTurnID: turnID, sessionEntryID: null },
  capabilities: [{ id: "agent.runtime-composition.v1", version: 1 }],
  hashes: {
    modelHash: "model", permissionHash: "permission", workspaceHash: "workspace",
    skillsHash: "skills", mcpHash: "mcp", toolsHash: "tools", promptHash: "prompt",
    contextHash: "context", overall: `overall:${turnID}`,
  },
})

const setup = () => {
  const path = join(tmpdir(), `codepilotx-runtime-composition-${crypto.randomUUID()}.sqlite`)
  paths.push(path)
  const db = new AgentDatabase(path)
  databases.push(db)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, {
    content: "compose",
    model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
    permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
    strategy: "queue",
    taskMode: "chat",
  })
  db.claimTurnExecution(turn.turnID)
  const agent = db.sqlite.query("SELECT id FROM agent_executions WHERE turn_id = ?").get(turn.turnID) as { id: string }
  return { db, turnID: turn.turnID, agentID: agent.id }
}

const runtime = (value: RuntimeCompositionSnapshotV1, release: () => void) => ({
  snapshot: value,
  harness: {} as never,
  bindings: { release: async () => release() } as never,
})

describe("RuntimeCompositionService", () => {
  test("首次 compose 在返回前持久化，resume 只 rebind 数据库权威 snapshot", async () => {
    const { db, turnID, agentID } = setup()
    const service = new RuntimeCompositionService({ db })
    let composeCalls = 0
    let rebindCalls = 0
    let releases = 0
    const first = await service.loadOrCompose({
      turnID,
      agentID,
      allowEphemeralFresh: false,
      compose: async () => runtime(snapshot(turnID), () => { releases += 1 }),
      rebind: async () => { throw new Error("fresh turn must not rebind") },
    })
    composeCalls += 1
    expect(service.repository.get(turnID)?.snapshot.prompt.instructions).toBe("frozen prompt")
    await first.release()
    await first.release()
    expect(releases).toBe(1)

    const resumed = await service.loadOrCompose({
      turnID,
      agentID,
      allowEphemeralFresh: false,
      compose: async () => { composeCalls += 1; throw new Error("resume must not compose") },
      rebind: async (stored) => {
        rebindCalls += 1
        expect(stored.identity.id).toBe(`rc:${turnID}`)
        return { harness: {} as never, bindings: { release: async () => undefined } as never }
      },
    })
    expect(composeCalls).toBe(1)
    expect(rebindCalls).toBe(1)
    await resumed.release()
  })

  test("snapshot 行不可更新、hash 损坏时 fail-closed、删除 Turn 后级联删除", async () => {
    const { db, turnID, agentID } = setup()
    const repository = db.repositories.runtimeCompositions
    const first = snapshot(turnID)
    repository.insertOrGet({ turnID, agentID, compositionID: first.identity.id, snapshot: first })
    const changed = structuredClone(first)
    changed.prompt.instructions = "new config must not replace old prompt"
    expect(() => repository.insertOrGet({ turnID, agentID, compositionID: changed.identity.id, snapshot: changed })).not.toThrow()
    expect(repository.get(turnID)?.snapshot.prompt.instructions).toBe("frozen prompt")
    db.sqlite.query("UPDATE runtime_composition_plans SET snapshot_hash = 'tampered' WHERE turn_id = ?").run(turnID)
    expect(() => repository.get(turnID)).toThrow("hash verification")
    db.sqlite.query("DELETE FROM turns WHERE id = ?").run(turnID)
    expect(db.sqlite.query("SELECT turn_id FROM runtime_composition_plans WHERE turn_id = ?").get(turnID)).toBeNull()
  })

  test("高版本缺表只允许 fresh ephemeral，恢复时 fail-closed 且不重组", async () => {
    const { db, turnID, agentID } = setup()
    db.sqlite.exec("DROP TABLE runtime_composition_plans")
    const service = new RuntimeCompositionService({ db })
    let composeCalls = 0
    const fresh = await service.loadOrCompose({
      turnID,
      agentID,
      allowEphemeralFresh: true,
      compose: async () => {
        composeCalls += 1
        return runtime(snapshot(turnID), () => undefined)
      },
      rebind: async () => { throw new Error("ephemeral fresh must not rebind") },
    })
    await fresh.release()
    await expect(service.loadOrCompose({
      turnID,
      agentID,
      allowEphemeralFresh: false,
      compose: async () => {
        composeCalls += 1
        return runtime(snapshot(turnID), () => undefined)
      },
      rebind: async () => { throw new Error("missing snapshot cannot rebind") },
    })).rejects.toMatchObject({ code: "RUNTIME_COMPOSITION_UNAVAILABLE" })
    expect(composeCalls).toBe(1)
  })
})
