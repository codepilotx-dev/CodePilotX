import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { ManagedProjectlessWorkspaceService, projectlessWorkspaceSlug } from "../src/workspace/ManagedProjectlessWorkspaceService"
import { ThreadWorkspaceResolver } from "../src/workspace/ThreadWorkspaceResolver"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { ThreadService } from "../src/session/ThreadService"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true })
        break
      } catch (cause) {
        if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "EBUSY") || attempt === 79) throw cause
        await Bun.sleep(25)
      }
    }
  }
})

describe("ManagedProjectlessWorkspaceService", () => {
  test("使用 Codex 风格 slug，并为中文回退 new-chat", () => {
    expect(projectlessWorkspaceSlug("Analyze the session start logic right now please")).toBe("analyze-the-session-start-logic-right")
    expect(projectlessWorkspaceSlug("分析发起会话逻辑")).toBe("new-chat")
  })

  test("创建隔离的 work/outputs，并原子处理同名碰撞", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-projectless-test-"))
    roots.push(root)
    const documents = join(root, "Documents")
    await mkdir(documents)
    const service = new ManagedProjectlessWorkspaceService(documents)
    const now = new Date("2026-07-22T08:00:00.000Z")
    const first = await service.allocate({ workspaceID: crypto.randomUUID(), threadID: crypto.randomUUID(), prompt: "Build report", now })
    await service.activate(first)
    const validated = await service.validatePersisted({
      threadID: first.threadID,
      sessionRoot: first.sessionRoot,
      cwd: first.cwd,
      outputDirectory: first.outputDirectory,
    })
    expect(basename(validated.cwd)).toBe("work")
    expect(basename(validated.outputDirectory)).toBe("outputs")

    const second = await service.allocate({ workspaceID: crypto.randomUUID(), threadID: crypto.randomUUID(), prompt: "Build report", now })
    expect(basename(first.sessionRoot)).toBe("build-report")
    expect(basename(second.sessionRoot)).toBe("build-report-2")
    await service.rollback(second)
  })

  test("ThreadService 原子创建 projectless thread，并按 operationId 幂等返回", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-projectless-thread-test-"))
    roots.push(root)
    const documents = join(root, "Documents")
    await mkdir(documents)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const managed = new ManagedProjectlessWorkspaceService(documents)
    const resolver = new ThreadWorkspaceResolver(db, managed)
    const questions = { setResumeHandler: () => undefined }
    const subagents = { setParentResumeHandler: () => undefined }
    const threads = new ThreadService(
      db, null as never, null as never, null as never, questions as never, null as never,
      subagents as never, null as never, root, null as never, null as never, resolver,
    )
    try {
      const operationID = crypto.randomUUID()
      const first = await threads.create({ operationID, workspace: { kind: "projectless", prompt: "Build report" } })
      const descriptor = db.threadWorkspace(first.id)
      expect(descriptor).toMatchObject({ kind: "projectless", projectID: null })
      if (descriptor?.kind !== "projectless") throw new Error("expected projectless workspace")
      expect(basename(descriptor.cwd)).toBe("work")
      expect(basename(descriptor.outputDirectory)).toBe("outputs")
      expect((await resolver.resolve(first.id)).cwd).toBe(descriptor.cwd)

      const duplicate = await threads.create({ operationID, workspace: { kind: "projectless", prompt: "Build report" } })
      expect(duplicate.id).toBe(first.id)
      await expect(threads.create({ operationID, workspace: { kind: "projectless", prompt: "Different" } })).rejects.toThrow("operationId")
    } finally {
      db.close()
    }
  })
})
