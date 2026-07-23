import { AgentError } from "../domain"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import { ManagedProjectlessWorkspaceService } from "./ManagedProjectlessWorkspaceService"
import type { AllocateManagedProjectlessWorkspaceInput, ManagedProjectlessWorkspaceAllocation } from "./ManagedProjectlessWorkspaceService"
import { WorkspaceService } from "./WorkspaceService"

export type ResolvedThreadWorkspace = {
  kind: "project" | "projectless"
  projectID: string | null
  workspaceRoot: string
  cwd: string
  outputDirectory: string | null
  workspace: WorkspaceService
}

export class ThreadWorkspaceResolver {
  constructor(
    private readonly db: AgentDatabase,
    private readonly projectless: ManagedProjectlessWorkspaceService,
  ) {}

  allocateProjectless(input: AllocateManagedProjectlessWorkspaceInput) {
    return this.projectless.allocate(input)
  }

  activateProjectless(allocation: ManagedProjectlessWorkspaceAllocation) {
    return this.projectless.activate(allocation)
  }

  rollbackProjectless(allocation: ManagedProjectlessWorkspaceAllocation) {
    return this.projectless.rollback(allocation)
  }

  async resolve(threadID: string): Promise<ResolvedThreadWorkspace> {
    const descriptor = this.db.threadWorkspace(threadID)
    if (!descriptor) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
    if (descriptor.kind === "project") {
      const project = this.db.getProject(descriptor.projectID)
      if (!project) throw new AgentError("PROJECT_NOT_FOUND", "当前项目不存在", 404)
      const workspace = await WorkspaceService.open(project.rootPath)
      return {
        kind: "project",
        projectID: descriptor.projectID,
        workspaceRoot: workspace.rootPath,
        cwd: workspace.rootPath,
        outputDirectory: null,
        workspace,
      }
    }
    try {
      const validated = await this.projectless.ensureActivePersisted({
        threadID,
        sessionRoot: descriptor.workspaceRoot,
        cwd: descriptor.cwd,
        outputDirectory: descriptor.outputDirectory,
      })
      const workspace = await WorkspaceService.open(validated.sessionRoot)
      return {
        kind: "projectless",
        projectID: null,
        workspaceRoot: workspace.rootPath,
        cwd: validated.cwd,
        outputDirectory: validated.outputDirectory,
        workspace,
      }
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === "THREAD_NOT_FOUND") throw cause
      throw new AgentError(
        "PROJECTLESS_WORKSPACE_UNAVAILABLE",
        cause instanceof Error ? `无项目会话工作目录不可用：${cause.message}` : "无项目会话工作目录不可用",
        409,
      )
    }
  }
}
