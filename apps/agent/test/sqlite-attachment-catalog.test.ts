import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Model, Provider } from "@codepilotx/model-schema"
import { removeFixturePaths } from "./fixture-cleanup"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { AttachmentService } from "../src/subagent/AttachmentService"
import { SqliteAttachmentCatalog } from "../src/subagent/SqliteAttachmentCatalog"

const paths: string[] = []
afterEach(async () => { await removeFixturePaths(paths.splice(0)) })

describe("SQLite 附件目录", () => {
  test("附件跨服务实例读取、绑定到 input，并随父 Thread 级联删除", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-attachment-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, {
      content: "读取附件",
      model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") }),
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
      strategy: "queue",
      taskMode: "chat",
    })
    const first = await AttachmentService.open(root, { catalog: new SqliteAttachmentCatalog(db) })
    const [stored] = await first.store([{ kind: "text", name: "notes.txt", mimeType: "text/plain; charset=utf-8", data: "你好 UTF-8" }])
    await first.bind([stored!.id], { type: "input", id: turn.inputID })

    const reopened = await AttachmentService.open(root, { catalog: new SqliteAttachmentCatalog(db) })
    expect((await reopened.readText(stored!.id)).text).toBe("你好 UTF-8")
    expect(await reopened.listByBinding({ type: "input", id: turn.inputID })).toMatchObject([{ id: stored!.id, binding: { type: "input", id: turn.inputID } }])
    db.sqlite.query("DELETE FROM threads WHERE id = ?").run(thread.id)
    expect((db.sqlite.query("SELECT COUNT(*) AS count FROM input_attachments").get() as { count: number }).count).toBe(0)
    db.close()
  })
})
