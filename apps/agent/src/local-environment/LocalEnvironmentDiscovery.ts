import { access } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { createHash } from "node:crypto"
import { AgentError } from "../domain"
import type { GitCommandRunner } from "../git/GitCommandRunner"

export const LOCAL_ENVIRONMENT_RELATIVE_PATH = join(".codepilotx", "environments", "environment.jsonc")

export type DiscoveredLocalEnvironment = {
  gitRoot: string
  filePath: string
  exists: boolean
  projectIdentity: string
}

const fileExists = async (path: string) => access(path).then(() => true, () => false)

export class LocalEnvironmentDiscovery {
  constructor(private readonly git: GitCommandRunner) {}

  async discover(cwd: string): Promise<DiscoveredLocalEnvironment> {
    let gitRoot: string
    try {
      const result = await this.git.run({ cwd, args: ["rev-parse", "--show-toplevel"] })
      gitRoot = resolve(result.stdout.trim())
    } catch {
      throw new AgentError("LOCAL_ENVIRONMENT_NOT_GIT", "当前目录不在 Git 仓库中", 409)
    }
    const start = resolve(cwd)
    const relation = relative(gitRoot, start)
    if (relation.startsWith("..") || resolve(gitRoot, relation) !== start) {
      throw new AgentError("LOCAL_ENVIRONMENT_NOT_GIT", "Git 工作目录解析结果无效", 409)
    }
    const commonDirResult = await this.git.run({ cwd, args: ["rev-parse", "--git-common-dir"] })
    const commonDir = resolve(gitRoot, commonDirResult.stdout.trim())
    const canonical = process.platform === "win32" ? commonDir.toLocaleLowerCase() : commonDir
    const projectIdentity = createHash("sha256").update(canonical, "utf8").digest("hex")
    let current = start
    while (true) {
      const candidate = join(current, LOCAL_ENVIRONMENT_RELATIVE_PATH)
      if (await fileExists(candidate)) return { gitRoot, filePath: candidate, exists: true, projectIdentity }
      if (current === gitRoot) return { gitRoot, filePath: join(gitRoot, LOCAL_ENVIRONMENT_RELATIVE_PATH), exists: false, projectIdentity }
      const parent = dirname(current)
      if (parent === current) throw new AgentError("LOCAL_ENVIRONMENT_NOT_GIT", "Git 工作目录解析结果无效", 409)
      current = parent
    }
  }
}
