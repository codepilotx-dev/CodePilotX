import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Api, Model as PiModel } from "@earendil-works/pi-ai"
import type { Model } from "@codepilotx/model-schema"
import { AgentLogger } from "../src/observability/AgentLogger"
import type { PiModelService } from "../src/provider/pi/PiModelService"
import { ThreadHistoryService } from "../src/session/ThreadHistoryService"
import {
  THREAD_TITLE_MAX_LENGTH,
  ThreadTitleService,
  normalizeThreadTitle,
} from "../src/session/ThreadTitleService"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { EventHub } from "../src/storage/events/EventHub"

const roots: string[] = []
const databases: AgentDatabase[] = []

const removeFixtureRoot = async (root: string) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        !(error instanceof Error)
        || !("code" in error)
        || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(error.code))
        || attempt === 79
      ) {
        throw error
      }
      await Bun.sleep(25)
    }
  }
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await Promise.all(roots.splice(0).map(removeFixtureRoot))
})

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-thread-title-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  const hub = await Effect.runPromise(EventHub.make)
  const history = new ThreadHistoryService(db, hub)
  const logger = new AgentLogger(join(root, "logs"))
  return { db, history, logger }
}

const config = {
  snapshot: () => ({
    model_provider: "provider:test",
    task_models: { small_fast: "small", fast: "fast" },
  }),
  read: async () => ({
    config: {
      model_provider: "provider:test",
      task_models: { small_fast: "small", fast: "fast" },
    },
  }),
} as never

const addUserMessage = (db: AgentDatabase, threadID: string, content: string) => {
  return db.createTurn(threadID, {
    content,
    model: { providerID: "provider:test", id: "fast" } as Model.Ref,
    permissionConfig: {
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    },
    strategy: "queue",
    taskMode: "chat",
  })
}

describe("ThreadTitleService", () => {
  test("uses the auxiliary-model fallback chain and persists a normalized 20-character title", async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    addUserMessage(db, thread.id, "# 修复设置页下拉框文字消失并统一选项布局")
    const activityAt = history.getListItem(thread.id)!.updatedAt
    const attemptedModels: string[] = []
    const models = {
      pi: {},
      getPiModel: async (ref: Model.Ref) => {
        attemptedModels.push(String(ref.id))
        if (String(ref.id) === "small") throw new Error("unavailable")
        return { provider: "provider:test", id: "fast" } as PiModel<Api>
      },
    } as unknown as Pick<PiModelService, "pi" | "getPiModel">
    const service = new ThreadTitleService(
      db,
      history,
      models,
      logger,
      config,
      {
        generate: async () => ({
          title: "# 这是一个非常非常长的会话标题用于验证统一截断行为",
        }),
      },
    )

    await service.generateForFirstMessage(thread.id, "# 修复设置页下拉框文字消失并统一选项布局")

    const title = history.getListItem(thread.id)?.title ?? ""
    expect(attemptedModels).toEqual(["small", "fast"])
    expect(title.startsWith("#")).toBe(false)
    expect(Array.from(title)).toHaveLength(THREAD_TITLE_MAX_LENGTH)
    expect(title.endsWith("…")).toBe(true)
    expect(history.getListItem(thread.id)?.updatedAt).toBe(activityAt)
  })

  test("persists a deterministic fallback when no auxiliary model is configured", async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    const content = "> **修复普通下拉框文字消失并保持现有交互行为**"
    addUserMessage(db, thread.id, content)
    const service = new ThreadTitleService(
      db,
      history,
      { pi: {}, getPiModel: async () => { throw new Error("unexpected") } } as never,
      logger,
    )

    await service.generateForFirstMessage(thread.id, content)

    expect(history.getListItem(thread.id)?.title).toBe(normalizeThreadTitle(content))
    expect(history.getListItem(thread.id)?.title).not.toContain("*")
  })

  test("persists the fallback when title generation times out", async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    const content = "修复标题生成超时后的回退行为"
    addUserMessage(db, thread.id, content)
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: "provider:test", id: "small" }) as PiModel<Api>,
      } as never,
      logger,
      config,
      {
        timeoutMs: 5,
        generate: async ({ signal }) => new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        }),
      },
    )

    await service.generateForFirstMessage(thread.id, content)

    expect(history.getListItem(thread.id)?.title).toBe(content)
  })

  test("persists the fallback when generated output is invalid", async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    const content = "修复无效标题输出的回退行为"
    addUserMessage(db, thread.id, content)
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: "provider:test", id: "small" }) as PiModel<Api>,
      } as never,
      logger,
      config,
      { generate: async () => ({ title: "   " }) },
    )

    await service.generateForFirstMessage(thread.id, content)

    expect(history.getListItem(thread.id)?.title).toBe(content)
  })

  test("does not overwrite a manual rename while title generation is in flight", async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    addUserMessage(db, thread.id, "实现异步标题")
    let resolveGenerated!: (value: { title: string }) => void
    const generated = new Promise<{ title: string }>(resolve => {
      resolveGenerated = resolve
    })
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: "provider:test", id: "small" }) as PiModel<Api>,
      } as never,
      logger,
      config,
      { generate: async () => generated },
    )

    const pending = service.generateForFirstMessage(thread.id, "实现异步标题")
    await history.patch(thread.id, { title: "用户手工标题" })
    resolveGenerated({ title: "模型生成标题" })
    await pending

    expect(history.getListItem(thread.id)?.title).toBe("用户手工标题")
  })

  test("skips explicit titles and threads that already contain multiple messages", async () => {
    const { db, history, logger } = await fixture()
    let generated = 0
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: "provider:test", id: "small" }) as PiModel<Api>,
      } as never,
      logger,
      config,
      {
        generate: async () => {
          generated += 1
          return { title: "不应生成" }
        },
      },
    )
    const explicit = db.createThread("技能会话标题")
    addUserMessage(db, explicit.id, "第一条")
    await service.generateForFirstMessage(explicit.id, "第一条")
    const multiple = db.createThread()
    addUserMessage(db, multiple.id, "第一条")
    addUserMessage(db, multiple.id, "第二条")
    await service.generateForFirstMessage(multiple.id, "第二条")

    expect(generated).toBe(0)
    expect(history.getListItem(explicit.id)?.title).toBe("技能会话标题")
    expect(history.getListItem(multiple.id)?.title).toBe("新对话")
  })

  test("regenerates from only the latest completed user and assistant content", async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread("用户旧标题")
    const previous = addUserMessage(db, thread.id, "旧一轮内容不应进入标题上下文")
    db.updateTurnStatus(previous.turnID, "completed")
    const latest = addUserMessage(db, thread.id, "根据最新完成内容更新标题")
    const timestamp = Date.now()
    db.upsertItem(thread.id, {
      id: "latest-result",
      turnID: latest.turnID,
      agentID: latest.agentID,
      type: "text",
      status: "completed",
      data: { placement: "result", text: "已经完成会话标题刷新功能" },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    db.upsertItem(thread.id, {
      id: "latest-tool",
      turnID: latest.turnID,
      agentID: latest.agentID,
      type: "tool",
      status: "completed",
      data: { tool: "Shell", output: "工具输出不应进入标题上下文" },
      createdAt: timestamp + 1,
      updatedAt: timestamp + 1,
    })
    db.updateTurnStatus(latest.turnID, "completed")
    const activityAt = history.getListItem(thread.id)!.updatedAt
    let receivedPrompt = ""
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: "provider:test", id: "small" }) as PiModel<Api>,
      } as never,
      logger,
      config,
      {
        generate: async ({ prompt }) => {
          receivedPrompt = prompt
          return { title: "更新会话标题功能" }
        },
      },
    )

    const updated = await service.regenerateFromLatest(thread.id)

    expect(updated.title).toBe("更新会话标题功能")
    expect(receivedPrompt).toContain("根据最新完成内容更新标题")
    expect(receivedPrompt).toContain("已经完成会话标题刷新功能")
    expect(receivedPrompt).not.toContain("旧一轮内容")
    expect(receivedPrompt).not.toContain("工具输出")
    expect(updated.updatedAt).toBe(activityAt)
    expect(db.eventsAfter(0).at(-1)?.method).toBe("thread/updated")
  })

  test("explicit regeneration uses fallback and does not overwrite a concurrent rename", async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread("原手工标题")
    const turn = addUserMessage(db, thread.id, "# 最新用户内容用于确定性回退")
    db.updateTurnStatus(turn.turnID, "completed")
    let resolveGenerated!: (value: { title: string }) => void
    const generated = new Promise<{ title: string }>(resolve => {
      resolveGenerated = resolve
    })
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: "provider:test", id: "small" }) as PiModel<Api>,
      } as never,
      logger,
      config,
      { generate: async () => generated },
    )

    const pending = service.regenerateFromLatest(thread.id)
    await history.patch(thread.id, { title: "并发手工标题" })
    resolveGenerated({ title: "模型刷新标题" })
    const updated = await pending

    expect(updated.title).toBe("并发手工标题")
    expect(history.getListItem(thread.id)?.title).toBe("并发手工标题")

    const fallback = new ThreadTitleService(
      db,
      history,
      { pi: {}, getPiModel: async () => { throw new Error("unavailable") } } as never,
      logger,
    )
    const fallbackUpdated = await fallback.regenerateFromLatest(thread.id)
    expect(fallbackUpdated.title).toBe("最新用户内容用于确定性回退")
  })

  test("rejects regeneration unless the latest turn completed successfully", async () => {
    const { db, history, logger } = await fixture()
    const service = new ThreadTitleService(
      db,
      history,
      { pi: {}, getPiModel: async () => { throw new Error("unexpected") } } as never,
      logger,
    )
    const empty = db.createThread()
    await expect(service.regenerateFromLatest(empty.id)).rejects.toMatchObject({
      code: "CONFLICT",
    })

    for (const status of ["queued", "running", "waiting_question", "failed", "interrupted"] as const) {
      const thread = db.createThread(`状态 ${status}`)
      const turn = addUserMessage(db, thread.id, `状态 ${status}`)
      db.updateTurnStatus(turn.turnID, status)
      await expect(service.regenerateFromLatest(thread.id)).rejects.toMatchObject({
        code: status === "queued" || status === "running" || status === "waiting_question"
          ? "TURN_ACTIVE"
          : "CONFLICT",
      })
    }
  })
})
