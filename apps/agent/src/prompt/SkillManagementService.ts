import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { InstalledSkill } from "@codepilotx/agent-protocol"
import {
  SkillSettingsConflictError,
  SkillSettingsRepository,
} from "../storage/repositories/skill-settings-repository"
import { SkillService, type SkillMetadata, type SkillScanOptions } from "./SkillService"

type SkillStorageRoots = {
  dataRoot: string
  userHome: string
}

export class SkillManagementError extends Error {
  constructor(
    readonly code: "SKILL_NOT_FOUND" | "PATH_DENIED" | "CONFLICT" | "INTERNAL_ERROR",
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const normalizedIdentityPath = (path: string) => {
  const absolute = resolve(path)
  return process.platform === "win32" ? absolute.toLowerCase() : absolute
}

export const skillPathIdentity = (path: string) =>
  createHash("sha256").update(normalizedIdentityPath(path), "utf8").digest("hex")

const toInstalledSkill = (
  skill: SkillMetadata,
  disabled: ReadonlySet<string>,
): InstalledSkill => ({
  name: skill.name,
  description: skill.description,
  path: skill.path,
  scope: skill.origin,
  format: skill.format,
  enabled: !disabled.has(skillPathIdentity(skill.path)),
})

export class SkillManagementService {
  private readonly knownSkills = new Map<string, SkillMetadata>()

  constructor(
    private readonly settings: SkillSettingsRepository,
    private readonly roots: SkillStorageRoots,
  ) {}

  runtimeService() {
    const disabled = this.settings.disabledPathHashes()
    return new SkillService({
      enabled: (skill) => !disabled.has(skillPathIdentity(skill.path)),
    })
  }

  async list(input: { workspace?: string | undefined; forceReload?: boolean | undefined } = {}) {
    const catalog = await this.scan(input.workspace)
    const state = this.settings.state()
    for (const skill of catalog.skills) {
      this.knownSkills.set(normalizedIdentityPath(skill.path), skill)
    }
    return {
      skills: catalog.skills.map((skill) => toInstalledSkill(skill, new Set(state.disabledPathHashes))),
      generation: state.generation,
      updatedAt: state.updatedAt,
    }
  }

  async read(input: { workspace?: string | undefined; path: string }) {
    const skill = await this.resolveDiscoveredSkill(input.path, input.workspace)
    const state = this.settings.state()
    try {
      const loaded = await this.scanService(input.workspace).then(({ service }) => service.read(skill.name))
      if (normalizedIdentityPath(loaded.path) !== normalizedIdentityPath(skill.path)) {
        throw new SkillManagementError("SKILL_NOT_FOUND", "技能不存在或已被替换", 404)
      }
      return {
        skill: toInstalledSkill(skill, new Set(state.disabledPathHashes)),
        content: loaded.content,
      }
    } catch (cause) {
      if (cause instanceof SkillManagementError) throw cause
      throw new SkillManagementError("SKILL_NOT_FOUND", "技能不存在或无法读取", 404)
    }
  }

  async setEnabled(input: { path: string; enabled: boolean; operationId: string }) {
    const skill = await this.resolveKnownSkill(input.path)
    try {
      const result = this.settings.setEnabled({
        pathHash: skillPathIdentity(skill.path),
        enabled: input.enabled,
        operationId: input.operationId,
      })
      return {
        result: {
          skill: {
            ...toInstalledSkill(skill, new Set(result.state.disabledPathHashes)),
            enabled: input.enabled,
          },
          generation: result.state.generation,
          updatedAt: result.state.updatedAt,
        },
        changed: result.changed,
      }
    } catch (cause) {
      if (cause instanceof SkillSettingsConflictError) {
        throw new SkillManagementError("CONFLICT", cause.message, 409)
      }
      throw cause
    }
  }

  private scanOptions(workspace?: string): SkillScanOptions {
    return {
      workspaceRoot: workspace ?? this.roots.userHome,
      dataRoot: this.roots.dataRoot,
      userHome: this.roots.userHome,
      includeWorkspace: workspace !== undefined,
    }
  }

  private async scanService(workspace?: string) {
    const service = new SkillService()
    try {
      const catalog = await service.scan(this.scanOptions(workspace))
      return { service, catalog }
    } catch {
      throw new SkillManagementError("INTERNAL_ERROR", "技能目录扫描失败", 500)
    }
  }

  private async scan(workspace?: string) {
    return (await this.scanService(workspace)).catalog
  }

  private async canonicalRequestedPath(path: string) {
    if (!isAbsolute(path)) {
      throw new SkillManagementError("PATH_DENIED", "技能路径必须是绝对路径", 403)
    }
    try {
      return await realpath(path)
    } catch {
      throw new SkillManagementError("SKILL_NOT_FOUND", "技能不存在", 404)
    }
  }

  private async resolveDiscoveredSkill(path: string, workspace?: string) {
    const canonical = await this.canonicalRequestedPath(path)
    const catalog = await this.scan(workspace)
    const skill = catalog.skills.find((candidate) =>
      normalizedIdentityPath(candidate.path) === normalizedIdentityPath(canonical))
    if (!skill) throw new SkillManagementError("SKILL_NOT_FOUND", "技能不存在或不在允许的技能目录中", 404)
    this.knownSkills.set(normalizedIdentityPath(skill.path), skill)
    return skill
  }

  private async resolveKnownSkill(path: string) {
    const canonical = await this.canonicalRequestedPath(path)
    const skill = this.knownSkills.get(normalizedIdentityPath(canonical))
    if (!skill) throw new SkillManagementError("SKILL_NOT_FOUND", "技能不存在或尚未发现", 404)
    return skill
  }
}
