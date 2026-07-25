import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { InstructionDiscoveryService } from "../src/prompt/InstructionDiscoveryService"
import { PromptComposer } from "../src/prompt/PromptComposer"
import { inferPromptCacheCapability } from "../src/prompt/PromptCache"
import { createPromptSections } from "../src/prompt/sections"
import { SkillService } from "../src/prompt/SkillService"

const paths: string[] = []
const temporaryDirectory = async () => {
  const path = await mkdtemp(join(tmpdir(), "codepilotx-prompt-"))
  paths.push(path)
  return path
}
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("项目指令发现", () => {
  test("从根到 cwd 分层，并在每层选择最高优先级文件", async () => {
    const root = await temporaryDirectory()
    const cwd = join(root, "packages", "feature")
    await mkdir(cwd, { recursive: true })
    await writeFile(join(root, "AGENTS.md"), "root agents", "utf8")
    await writeFile(join(root, "CLAUDE.md"), "ignored", "utf8")
    await writeFile(join(root, "packages", "AGENTS.override.md"), "package override", "utf8")
    await writeFile(join(root, "packages", "AGENTS.md"), "ignored package", "utf8")
    await writeFile(join(cwd, "CLAUDE.md"), "feature claude", "utf8")

    const result = await new InstructionDiscoveryService().discover(root, cwd)
    expect(result.sources.map((source) => [source.scope, source.content])).toEqual([
      [".", "root agents"],
      ["packages", "package override"],
      ["packages\\feature", "feature claude"],
    ])
  })

  test("执行 UTF-8 fatal 校验并限制总预算", async () => {
    const root = await temporaryDirectory()
    await writeFile(join(root, "AGENTS.md"), "你好世界", "utf8")
    const result = await new InstructionDiscoveryService().discover(root, root, { budgetBytes: 7 })
    expect(result.totalBytes).toBeLessThanOrEqual(7)
    expect(result.sources[0]?.content).toBe("你好")
    expect(result.truncated).toBe(true)
    await writeFile(join(root, "AGENTS.md"), Uint8Array.from([0xc3, 0x28]))
    await expect(new InstructionDiscoveryService().discover(root)).rejects.toThrow()
  })
})

describe("Skills catalog", () => {
  const writeSkill = async (base: string, compatibility: string, directory: string, document: string) => {
    const root = join(base, compatibility, "skills", directory)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, "SKILL.md"), document, "utf8")
    return root
  }

  test("workspace 和原生目录优先，并可按需读取正文", async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    await writeSkill(user, "", "deploy", "---\nname: deploy\ndescription: user native\n---\nuser")
    await writeSkill(workspace, ".claude", "deploy", "---\nname: deploy\ndescription: workspace compatible\n---\nworkspace")
    await writeSkill(workspace, ".codepilotx", "deploy-native", "---\nname: deploy\ndescription: >-\n  workspace\n  native\nmetadata:\n  category: release\n---\nnative")

    const service = new SkillService()
    const catalog = await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })
    expect(catalog.skills).toHaveLength(1)
    expect(catalog.skills[0]?.description).toBe("workspace native")
    expect(catalog.shadowed).toHaveLength(2)
    expect((await service.read("deploy")).body.trim()).toBe("native")
    expect(service.resolveInvocation("/deploy now")?.name).toBe("deploy")
    expect(service.resolveInvocation("$deploy")?.name).toBe("deploy")
    expect(service.resolveInvocation("please deploy")).toBeNull()
  })

  test("使用 YAML 解析复杂 frontmatter 并读取 allowedTools ceiling", async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    await writeSkill(workspace, ".codepilotx", "audit", [
      "---",
      "name: audit",
      "description: |",
      "  first line",
      "  second line",
      "allowedTools:",
      "  - Read",
      "  - workspace_search",
      "metadata:",
      "  nested: true",
      "---",
      "body",
    ].join("\n"))
    const service = new SkillService()
    const catalog = await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })
    expect(catalog.skills[0]?.description).toBe("first line\nsecond line\n")
    expect(catalog.skills[0]?.metadata.metadata).toEqual({ nested: true })
    expect(service.allowedTools("audit")).toEqual(["Read", "workspace_search"])
  })

  test("安全去重指向另一个已配置技能根的 Junction 别名", async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const source = await writeSkill(user, ".agents", "shared", "---\nname: shared\ndescription: shared skill\n---\nbody")
    const aliasRoot = join(user, ".claude", "skills")
    await mkdir(aliasRoot, { recursive: true })
    await symlink(source, join(aliasRoot, "shared"), "junction")

    const service = new SkillService()
    const catalog = await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })

    expect(catalog.skills.map(skill => ({
      name: skill.name,
      origin: skill.origin,
      format: skill.format,
    }))).toEqual([{
      name: "shared",
      origin: "user",
      format: "agents",
    }])
    expect(catalog.shadowed).toEqual([])
  })

  test("拒绝指向所有已配置技能根之外的 Junction", async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const outside = await temporaryDirectory()
    const source = await writeSkill(outside, "", "escape", "---\nname: escape\n---\nbody")
    const aliasRoot = join(user, ".claude", "skills")
    await mkdir(aliasRoot, { recursive: true })
    await symlink(source, join(aliasRoot, "escape"), "junction")

    await expect(new SkillService().scan({
      workspaceRoot: workspace,
      dataRoot: user,
      userHome: user,
    })).rejects.toThrow("Skill 目录逃出 Skills 根")
  })

  test("相对资源被限制在 Skill 根目录内", async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const root = await writeSkill(workspace, ".codepilotx", "safe", "---\nname: safe\n---\nbody")
    await writeFile(join(root, "reference.txt"), "ok", "utf8")
    const service = new SkillService()
    await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })
    expect(await service.resolveResource("safe", "reference.txt")).toBe(join(root, "reference.txt"))
    await expect(service.resolveResource("safe", "../SKILL.md")).rejects.toThrow("逃出")
  })

  test("拒绝通过链接逃出 Skill 根", async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const outside = await temporaryDirectory()
    const root = await writeSkill(workspace, ".codepilotx", "safe", "---\nname: safe\n---\nbody")
    await writeFile(join(outside, "secret.txt"), "secret", "utf8")
    await symlink(outside, join(root, "outside"), "junction")
    const service = new SkillService()
    await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })
    await expect(service.resolveResource("safe", "outside/secret.txt")).rejects.toThrow("链接逃出")
  })
})

describe("PromptComposer", () => {
  test("安全前缀不可被 systemPrompt 替换，项目内容只进入 contextual-user", () => {
    const sections = createPromptSections({
      permissionInstructions: "resolved permission",
      mode: "chat",
      profile: "main",
      toolGuidance: [{ name: "shell", content: "shell guidance" }, { name: "hidden", content: "hidden guidance" }],
      systemPrompt: "custom working style",
      projectInstructions: [{ path: "F:\\repo\\AGENTS.md", scope: ".", content: "project evidence", hash: "x", bytes: 16, truncated: false }],
      userMessage: "do work",
    })
    const bundle = new PromptComposer().compose({ threadID: "thread-1", mode: "chat", profile: "main", exposedTools: ["shell"], sections })
    expect(bundle.instructions).toContain("CodePilotX")
    expect(bundle.instructions).toContain("resolved permission")
    expect(bundle.instructions).toContain("custom working style")
    expect(bundle.instructions).toContain("shell guidance")
    expect(bundle.instructions).not.toContain("hidden guidance")
    expect(bundle.instructions).not.toContain("project evidence")
    expect(JSON.stringify(bundle.contextItems)).toContain("project evidence")
    expect(bundle.cacheKey).toBe("thread-1")
    expect(bundle.diagnostics.find((item) => item.id === "tool.hidden")?.reason).toBe("required-tools")
    expect(bundle.cacheSegments.filter((segment) => segment.role === "context").every((segment) => !segment.cacheable)).toBe(true)
    expect(bundle.cacheBoundaries.map((boundary) => boundary.cache)).toEqual(["global-stable", "session-stable"])
    expect(bundle.cacheHash).toHaveLength(64)
  })

  test("按 provider 推导缓存能力", () => {
    expect(inferPromptCacheCapability("openai.responses").strategy).toBe("prompt-cache-key")
    expect(inferPromptCacheCapability("anthropic.messages").strategy).toBe("explicit-ephemeral")
    expect(inferPromptCacheCapability("openai-compatible.chat").strategy).toBe("stable-prefix")
  })

})
