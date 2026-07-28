import { AgentError } from "../domain"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import { ManagedProjectlessWorkspaceService } from "./ManagedProjectlessWorkspaceService"
import type { AllocateManagedProjectlessWorkspaceInput, ManagedProjectlessWorkspaceAllocation } from "./ManagedProjectlessWorkspaceService"
import { WorkspaceService } from "./WorkspaceService"

type ResolvedWorkspaceBase = {
  workspaceRoot: string
  cwd: string
  runtimeWorkspaceRoots: Array<{
    folderId: string
    path: string
    role: "primary" | "secondary"
  }>
  instructionSources: string[]
  workspace: WorkspaceService
}

export type ResolvedThreadWorkspace =
  | ResolvedWorkspaceBase & {
      kind: "project"
      projectID: string
      outputDirectory: null
    }
  | ResolvedWorkspaceBase & {
      kind: "projectless"
      projectID: null
      outputDirectory: string
    }

type RuntimeProject = {
  rootPath?: string
  removedAt?: number | null
  primaryFolderId?: string
  folders?: Array<{
    id: string
    path: string
    role: "primary" | "secondary"
    availability?: "available" | "missing"
  }>
}

type ProjectWorkspaceDescriptor = {
  cwd?: string
  instructionSources?: string[]
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
      const project = this.db.getProject(descriptor.projectID) as RuntimeProject | null
      if (!project) throw new AgentError("PROJECT_NOT_FOUND", "当前项目不存在", 404)
      if (project.removedAt) throw new AgentError("PROJECT_REMOVED", "当前项目已被移除，归档任务不能继续执行", 409)
      const folders = project.folders?.filter((folder) => folder.availability !== "missing") ?? []
      const primary = folders.find((folder) => folder.id === project.primaryFolderId)
        ?? folders.find((folder) => folder.role === "primary")
      const primaryPath = primary?.path ?? project.rootPath
      if (!primaryPath) throw new AgentError("PROJECT_FOLDER_NOT_FOUND", "项目主目录不存在", 409)
      const workspace = await WorkspaceService.openRoots({
        primaryRoot: primaryPath,
        roots: folders.length > 0
          ? folders.map((folder) => ({ folderId: folder.id, path: folder.path, role: folder.role }))
          : [{ path: primaryPath, role: "primary" }],
      })
      const saved = descriptor as typeof descriptor & ProjectWorkspaceDescriptor
      const requestedCwd = saved.cwd ?? workspace.rootPath
      const cwd = await workspace.resolveDirectory(requestedCwd).catch((cause) => {
        if (requestedCwd !== workspace.rootPath) {
          throw new AgentError("THREAD_WORKSPACE_UNAVAILABLE", "Thread 持久化 cwd 已不在当前项目目录内或不可访问", 409)
        }
        throw cause
      })
      return {
        kind: "project",
        projectID: descriptor.projectID,
        workspaceRoot: workspace.rootPath,
        cwd,
        runtimeWorkspaceRoots: workspace.workspaceRoots.map((root) => ({
          folderId: root.folderId ?? root.path,
          path: root.path,
          role: root.role,
        })),
        instructionSources: [...(saved.instructionSources ?? [])],
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
        runtimeWorkspaceRoots: [],
        instructionSources: [],
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
