import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Api, Model as PiModel } from "@earendil-works/pi-ai"
import type { Model } from "@codepilotx/model-schema"
import type {
  TaskSuggestion,
  TaskSuggestionGenerateParams,
} from "@codepilotx/agent-protocol"
import { removeFixturePaths } from "./fixture-cleanup"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { MemoryService } from "../src/memory/MemoryService"
import { AgentLogger } from "../src/observability/AgentLogger"
import type { PiModelService } from "../src/provider/pi/PiModelService"
import { TaskSuggestionService } from "../src/suggestion/TaskSuggestionService"

const roots: string[] = []

afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
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

const workingCandidates = [
  {
    id: "working:1",
    categoryId: "create",
    label: "创建项目交付物",
    prompt: "Create the next project deliverable",
  },
  {
    id: "working:2",
    categoryId: "research",
    label: "调研后续步骤",
    prompt: "Research and plan the next steps",
  },
  {
    id: "working:3",
    categoryId: "automate",
    label: "自动化重复工作",
    prompt: "Automate the recurring work",
  },
] as const

const params = (
  projectId?: string,
  surface?: TaskSuggestionGenerateParams["surface"],
): TaskSuggestionGenerateParams => ({
  ...(surface ? { surface } : {}),
  workspace: projectId
    ? { kind: "project", projectId }
    : { kind: "projectless" },
  context: {
    workspaceName: projectId ? "fixture" : null,
    branchName: projectId ? "main" : null,
    git: null,
    recentTasks: [],
    localCandidates: surface === "working"
      ? [...workingCandidates]
      : [...localCandidates],
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

const workingGenerated: { suggestions: Array<Omit<TaskSuggestion, "id">> } = {
  suggestions: [
    {
      categoryId: "create",
      label: "整理项目交付物",
      prompt: "整理 C:\\private\\project-plan.md 并输出可评审的项目计划",
    },
    {
      categoryId: "research",
      label: "规划后续步骤",
      prompt: "调研最近会话与当前改动并规划后续步骤",
    },
    {
      categoryId: "automate",
      label: "自动化周报",
      prompt: "自动汇总每周进展，api_key=sk-1234567890abcdefghijklmnop",
    },
    {
      categoryId: "create",
      label: "额外交付物",
      prompt: "创建一份额外的项目交付清单",
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
      content: "项目使用 Bun，资料位于 C:\\private\\project-notes.md。",
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
    }, {
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
    } as never)

    const first = await service.generate(params(project.id), "project:key")
    const second = await service.generate(params(project.id), "project:key")

    expect(attemptedModels).toEqual(["small", "fast", "small", "fast"])
    expect(prompts).toHaveLength(1)
    expect(second).toEqual(first)
    expect(prompts[0]).toContain("用户偏好简洁的变更")
    expect(prompts[0]).toContain("项目使用 Bun")
    expect(prompts[0]).not.toContain("C:\\private")
    expect(prompts[0]).toContain("<path>")

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
      {
        snapshot: () => ({
          model_provider: "provider:test",
          task_models: { small_fast: "fast" },
        }),
        read: async () => ({
          config: {
            model_provider: "provider:test",
            task_models: { small_fast: "fast" },
          },
        }),
      } as never,
    )

    await service.generate(params())
    expect(prompt).toContain("用户记忆")
    expect(prompt).not.toContain("不应出现的项目记忆")
    db.close()
  })

  test("isolates Working generation with its own prompt, categories, and three-result limit", async () => {
    const { db, project, memory, logger } = await fixture()
    db.setSetting("desktop.settings.v1", {
      providerID: "provider:test",
      smallFastModel: "fast",
    })
    const model = { provider: "provider:test", id: "fast" } as PiModel<Api>
    const systems: string[] = []
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
          systems.push(input.system)
          return input.system.includes("Working") ? workingGenerated : generated
        },
      },
      {
        snapshot: () => ({
          model_provider: "provider:test",
          task_models: { small_fast: "fast" },
        }),
        read: async () => ({
          config: {
            model_provider: "provider:test",
            task_models: { small_fast: "fast" },
          },
        }),
      } as never,
    )

    const coding = await service.generate(params(project.id))
    const working = await service.generate(params(project.id, "working"))
    const cachedWorking = await service.generate(params(project.id, "working"))

    expect(systems).toHaveLength(2)
    expect(systems[0]).toContain("编码任务建议")
    expect(systems[1]).toContain("恰好返回 3 条")
    expect(systems[1]).toContain("不得把所有结果都描述成编码任务")
    expect(working.contextKey).not.toBe(coding.contextKey)
    expect(cachedWorking).toEqual(working)
    expect(working.suggestions).toHaveLength(3)
    expect(working.suggestions.map(item => item.categoryId)).toEqual([
      "create",
      "research",
      "automate",
    ])
    expect(working.suggestions[0]?.prompt).not.toContain("C:\\private")
    expect(working.suggestions[0]?.prompt).toContain("<path>")
    expect(working.suggestions[2]?.prompt).not.toContain("sk-123456")
    expect(working.suggestions[2]?.prompt).toContain("<redacted>")
    db.close()
  })

  test("rejects categories that do not belong to the requested surface", async () => {
    const { db, project, memory, logger } = await fixture()
    const service = new TaskSuggestionService(
      db,
      { pi: {}, getPiModel: async () => ({}) } as never,
      memory,
      logger,
    )
    const valid = params(project.id, "working")
    const invalid: TaskSuggestionGenerateParams = {
      ...valid,
      context: {
        ...valid.context,
        localCandidates: localCandidates.slice(0, 3),
      },
    }

    await expect(service.generate(invalid)).rejects.toMatchObject({
      reason: "invalid-output",
    })
    db.close()
  })
})
