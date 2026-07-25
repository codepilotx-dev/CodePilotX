import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import {
  SkillManagementError,
  SkillManagementService,
  skillPathIdentity,
} from "../src/prompt/SkillManagementService"
import { SkillSettingsRepository } from "../src/storage/repositories/skill-settings-repository"
import { skillHandlers } from "../src/transport/rpc/handlers/skills"
import type { RpcRouter } from "../src/transport/rpc/RpcRouter"

const roots: string[] = []

const removeRoot = async (root: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(50)
    }
  }
}

afterEach(async () => Promise.all(roots.splice(0).map(removeRoot)))

const writeSkill = async (
  root: string,
  compatibilityDirectory: ".codex" | ".agents" | ".codepilotx",
  name: string,
) => {
  const path = join(root, compatibilityDirectory, "skills", name, "SKILL.md")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `---\nname: ${name}\ndescription: ${name} description\n---\n# ${name}\n`, "utf8")
  return path
}

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-skill-management-"))
  roots.push(root)
  const workspace = join(root, "workspace")
  const dataRoot = join(root, "data")
  const userHome = join(root, "home")
  await Promise.all([mkdir(workspace), mkdir(dataRoot), mkdir(userHome)])
  const workspaceSkillPath = await writeSkill(workspace, ".codex", "workspace-skill")
  await writeSkill(userHome, ".agents", "user-skill")
  const database = new AgentDatabase({
    historyPath: join(root, "history.sqlite"),
    profilePath: join(root, "profile.sqlite"),
  })
  const settings = new SkillSettingsRepository(database)
  const service = new SkillManagementService(settings, { dataRoot, userHome })
  return { root, workspace, dataRoot, userHome, workspaceSkillPath, database, settings, service }
}

describe("SkillManagementService", () => {
  test("persists only path hashes and excludes disabled skills from a new runtime snapshot", async () => {
    const { workspace, workspaceSkillPath, database, settings, service } = await fixture()
    const listed = await service.list({ workspace })
    expect(listed.skills.map((skill) => [skill.name, skill.scope, skill.enabled])).toEqual([
      ["workspace-skill", "workspace", true],
      ["user-skill", "user", true],
    ])

    const disabled = await service.setEnabled({
      path: workspaceSkillPath,
      enabled: false,
      operationId: "operation:disable-workspace-skill",
    })
    expect(disabled.changed).toBe(true)
    expect(disabled.result).toMatchObject({
      skill: { name: "workspace-skill", enabled: false },
      generation: 2,
    })

    const stored = database.profileSqlite.query(
      "SELECT value FROM app_settings WHERE key = 'skills.settings.v1'",
    ).get() as { value: string }
    expect(stored.value).not.toContain(workspaceSkillPath)
    expect(stored.value).toContain(skillPathIdentity(workspaceSkillPath))

    const runtime = new SkillManagementService(settings, {
      dataRoot: join(dirname(workspace), "data"),
      userHome: join(dirname(workspace), "home"),
    }).runtimeService()
    const runtimeCatalog = await runtime.scan({
      workspaceRoot: workspace,
      dataRoot: join(dirname(workspace), "data"),
      userHome: join(dirname(workspace), "home"),
    })
    expect(runtimeCatalog.skills.map((skill) => skill.name)).toEqual(["user-skill"])
    expect(runtime.resolveInvocation("$workspace-skill")).toBeNull()
    expect(runtime.list().map((skill) => skill.name)).toEqual(["user-skill"])
    database.close()
  })

  test("allows only scanned skill documents and keeps errors free of requested paths", async () => {
    const { root, workspace, workspaceSkillPath, database, service } = await fixture()
    const details = await service.read({ workspace, path: workspaceSkillPath })
    expect(details.skill).toMatchObject({
      name: "workspace-skill",
      scope: "workspace",
      format: "codex",
      enabled: true,
    })
    expect(details.content).toContain("# workspace-skill")

    const outside = join(root, "outside.md")
    await writeFile(outside, "outside", "utf8")
    let rejected: unknown
    try {
      await service.read({ workspace, path: outside })
    } catch (cause) {
      rejected = cause
    }
    expect(rejected).toBeInstanceOf(SkillManagementError)
    expect(rejected).toMatchObject({ code: "SKILL_NOT_FOUND" })
    expect((rejected as Error).message).not.toContain(outside)
    database.close()
  })

  test("makes enable mutations idempotent and publishes generation-only updates", async () => {
    const { workspace, workspaceSkillPath, database, service } = await fixture()
    await service.list({ workspace })
    const emitted: Array<{ method: string; params: unknown }> = []
    const runtime = {
      dependencies: { skills: service },
      emit: async (method: string, params: unknown) => {
        emitted.push({ method, params })
      },
    } as unknown as RpcRouter
    const params = {
      path: workspaceSkillPath,
      enabled: false,
      operationId: "operation:disable",
    }

    const first = await skillHandlers.handle(runtime, "skill/setEnabled", params, {})
    await skillHandlers.handle(runtime, "skill/setEnabled", {
      ...params,
      enabled: true,
      operationId: "operation:enable",
    }, {})
    const duplicate = await skillHandlers.handle(runtime, "skill/setEnabled", params, {})
    expect(duplicate).toEqual(first)
    expect(emitted).toEqual([
      {
        method: "skill/updated",
        params: { generation: 2 },
      },
      {
        method: "skill/updated",
        params: { generation: 3 },
      },
    ])
    expect(JSON.stringify(emitted)).not.toContain(workspaceSkillPath)

    await expect(skillHandlers.handle(runtime, "skill/setEnabled", {
      ...params,
      enabled: true,
    }, {})).rejects.toMatchObject({ code: "CONFLICT" })
    database.close()
  })
})
