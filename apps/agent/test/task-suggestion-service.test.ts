import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Api, Model as PiModel } from "@earendil-works/pi-ai"
import type { Model } from "@codepilotx/model-schema"
import type {
  TaskSuggestion,
  TaskSuggestionGenerateParams,
} from "@codepilotx/agent-protocol"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { MemoryService } from "../src/memory/MemoryService"
import { AgentLogger } from "../src/observability/AgentLogger"
import type { PiModelService } from "../src/provider/pi/PiModelService"
import { TaskSuggestionService } from "../src/suggestion/TaskSuggestionService"

const roots: string[] = []

const removeFixtureRoot = async (root: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        !(error instanceof Error)
        || !("code" in error)
        || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(error.code))
        || attempt === 19
      ) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeFixtureRoot))
})

const localCandidates = [
  {
    id: "local:1",
    categoryId: "codex-review",
    label: "审查当前改动",
    prompt: "Review current changes",
  },
  {
    id: "local:2",
    categoryId: "codex-fix",
    label: "修复失败测试",
    prompt: "Fix failing tests",
  },
  {
    id: "local:3",
    categoryId: "codex-explore",
    label: "理解当前架构",
    prompt: "Explore current architecture",
  },
  {
    id: "local:4",
    categoryId: "codex-create",
    label: "继续构建功能",
    prompt: "Build the next feature",
  },
] as const

const params = (projectId?: string): TaskSuggestionGenerateParams => ({
  workspace: projectId
    ? { kind: "project", projectId }
    : { kind: "projectless" },
  context: {
    workspaceName: projectId ? "fixture" : null,
    branchName: projectId ? "main" : null,
    git: null,
    recentTasks: [],
    localCandidates: [...localCandidates],
  },
})

const generated: { suggestions: Array<Omit<TaskSuggestion, "id">> } = {
  suggestions: [
    {
      categoryId: "codex-review",
      label: "审查当前改动",
      prompt: "Review the current changes carefully",
    },
    {
      categoryId: "codex-fix",
      label: "修复失败测试",
      prompt: "Fix the currently failing tests",
    },
    {
      categoryId: "codex-create",
      label: "继续构建功能",
      prompt: "Build the next useful feature",
    },
  ],
}

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-suggestions-"))
  roots.push(root)
  await mkdir(join(root, "workspace"), { recursive: true })
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const project = db.createProject({ rootPath: join(root, "workspace") })
  const memory = new MemoryService(db, { enabled: true })
  const logger = new AgentLogger(join(root, "logs"))
  return { root, db, project, memory, logger }
}

describe("TaskSuggestionService", () => {
  test("uses fast-model fallback and caches identical memory/context", async () => {
    const { db, project, memory, logger } = await fixture()
    db.setSetting("desktop.settings.v1", {
      providerID: "provider:test",
      smallFastModel: "small",
      fastModel: "fast",
    })
    memory.remember({
      scope: "user",
      content: "用户偏好简洁的变更。",
    })
    memory.remember({
      scope: "project",
      projectKey: "project:key",
      content: "项目使用 Bun。",
    })
    const attemptedModels: string[] = []
    const model = { provider: "provider:test", id: "fast" } as PiModel<Api>
    const models = {
      pi: {},
      getPiModel: async (ref: Model.Ref) => {
        attemptedModels.push(String(ref.id))
        if (String(ref.id) === "small") throw new Error("unavailable")
        return model
      },
    } as unknown as Pick<PiModelService, "pi" | "getPiModel">
    const prompts: string[] = []
    const service = new TaskSuggestionService(db, models, memory, logger, {
      generate: async input => {
        prompts.push(input.prompt)
        return generated
      },
    })

    const first = await service.generate(params(project.id), "project:key")
    const second = await service.generate(params(project.id), "project:key")

    expect(attemptedModels).toEqual(["small", "fast", "small", "fast"])
    expect(prompts).toHaveLength(1)
    expect(second).toEqual(first)
    expect(prompts[0]).toContain("用户偏好简洁的变更")
    expect(prompts[0]).toContain("项目使用 Bun")

    memory.remember({
      scope: "project",
      projectKey: "project:key",
      content: "项目新增严格类型检查。",
    })
    await service.generate(params(project.id), "project:key")
    expect(prompts).toHaveLength(2)
    db.close()
  })

  test("does not include project memories for projectless suggestions", async () => {
    const { db, memory, logger } = await fixture()
    db.setSetting("desktop.settings.v1", {
      providerID: "provider:test",
      smallFastModel: "fast",
    })
    memory.remember({ scope: "user", content: "用户记忆" })
    memory.remember({
      scope: "project",
      projectKey: "other-project",
      content: "不应出现的项目记忆",
    })
    const model = { provider: "provider:test", id: "fast" } as PiModel<Api>
    let prompt = ""
    const service = new TaskSuggestionService(
      db,
      {
        pi: {},
        getPiModel: async () => model,
      } as unknown as Pick<PiModelService, "pi" | "getPiModel">,
      memory,
      logger,
      {
        generate: async input => {
          prompt = input.prompt
          return generated
        },
      },
    )

    await service.generate(params())
    expect(prompt).toContain("用户记忆")
    expect(prompt).not.toContain("不应出现的项目记忆")
    db.close()
  })
})
